/**
 * ROK-1366 AC2/AC4/AC7 (unit tier): POST /auth/redeem-magic-link wiring.
 * The real-DB behaviour (replay, concurrency, /auth/me) is covered by
 * magic-link.integration.spec.ts.
 */
import {
  HttpStatus,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import { MagicLinkController } from './magic-link.controller';
import {
  INVALID_MAGIC_LINK_MESSAGE,
  type MagicLinkService,
} from './magic-link.service';
import type { AuthService } from './auth.service';
import type { RefreshTokenService } from './refresh/refresh-token.service';
import { RATE_LIMIT_TIERS } from '../throttler/rate-limit.decorator';

const USER = { id: 9, username: 'mia', role: 'member' as const };

function setup() {
  const magic = { redeem: jest.fn().mockResolvedValue(USER) };
  const auth = { login: jest.fn().mockReturnValue({ access_token: 'acc' }) };
  const refresh = {
    issue: jest.fn().mockResolvedValue({ rawToken: 'raw-rt', maxAgeMs: 5000 }),
  };
  const ctrl = new MagicLinkController(
    magic as unknown as MagicLinkService,
    auth as unknown as AuthService,
    refresh as unknown as RefreshTokenService,
  );
  const res = { cookie: jest.fn() } as unknown as Response;
  return { ctrl, magic, auth, refresh, res };
}

function jsonReq(contentType = 'application/json'): Request {
  return {
    headers: { 'user-agent': 'UA/1.0' },
    is: (t: string) => (contentType.startsWith(t) ? t : false),
  } as unknown as Request;
}

describe('MagicLinkController — POST /auth/redeem-magic-link', () => {
  it('redeems, mints a magic refresh family + cookie, returns the access token', async () => {
    const { ctrl, magic, auth, refresh, res } = setup();

    const out = await ctrl.redeem({ token: 'tok' }, jsonReq(), res);

    expect(magic.redeem).toHaveBeenCalledWith('tok');
    expect(refresh.issue).toHaveBeenCalledWith(9, {
      authMethod: 'magic',
      userAgent: 'UA/1.0',
    });
    expect(res.cookie).toHaveBeenCalledWith(
      'rl_rt',
      'raw-rt',
      expect.objectContaining({ httpOnly: true, maxAge: 5000 }),
    );
    expect(auth.login).toHaveBeenCalledWith(USER);
    expect(out).toEqual({ access_token: 'acc' });
  });

  it.each(['application/x-www-form-urlencoded', 'text/plain'])(
    'rejects a %s body with 415 before touching the token',
    async (type) => {
      const { ctrl, magic, res } = setup();

      const call = ctrl.redeem({ token: 'tok' }, jsonReq(type), res);

      await expect(call).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
      await expect(call).rejects.toMatchObject({
        status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      });
      expect(magic.redeem).not.toHaveBeenCalled();
    },
  );

  it.each([[{}], [{ token: '' }], [null], [{ token: 42 }]])(
    'answers a malformed body %j with the shared invalid-link 401',
    async (body) => {
      const { ctrl, magic, res } = setup();

      const call = ctrl.redeem(body, jsonReq(), res);

      await expect(call).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(call).rejects.toThrow(INVALID_MAGIC_LINK_MESSAGE);
      expect(magic.redeem).not.toHaveBeenCalled();
    },
  );

  it('a failed redeem sets no cookie and mints no family', async () => {
    const { ctrl, magic, refresh, res } = setup();
    magic.redeem.mockRejectedValue(
      new UnauthorizedException(INVALID_MAGIC_LINK_MESSAGE),
    );

    await expect(
      ctrl.redeem({ token: 'spent' }, jsonReq(), res),
    ).rejects.toThrow(INVALID_MAGIC_LINK_MESSAGE);
    expect(refresh.issue).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('carries the auth rate-limit tier and no guard (AC7)', () => {
    const handler = MagicLinkController.prototype.redeem;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(
      RATE_LIMIT_TIERS.auth.limit,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MagicLinkController),
    ).toBeUndefined();
  });
});
