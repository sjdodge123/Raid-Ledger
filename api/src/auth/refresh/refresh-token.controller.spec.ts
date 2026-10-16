/**
 * Codex r3 (ROK-1810): /auth/refresh sets the rotated `rl_rt` cookie only
 * after the access token is minted; a concurrent-revoke rejection (null
 * mint) 401s without touching the cookie at all.
 */
import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { RefreshTokenController } from './refresh-token.controller';
import type { RefreshTokenService } from './refresh-token.service';
import type { ImpersonationSessionService } from '../impersonation/impersonation-session.service';
import type { TokenBlocklistService } from '../token-blocklist.service';
import { REFRESH_COOKIE_NAME } from './refresh-cookie.helpers';
import { mintRefreshAccessToken } from './refresh-access-token.helpers';

jest.mock('./refresh-access-token.helpers', () => ({
  mintRefreshAccessToken: jest.fn(),
}));
const mint = jest.mocked(mintRefreshAccessToken);

const ROTATED = {
  rawToken: 'new-raw-token',
  maxAgeMs: 1000,
  userId: 7,
  familyId: 'fam-1',
};

function build() {
  const rotate = jest.fn().mockResolvedValue(ROTATED);
  const refreshService = { rotate } as unknown as RefreshTokenService;
  const controller = new RefreshTokenController(
    refreshService,
    {} as JwtService,
    {} as PostgresJsDatabase<typeof schema>,
    {} as ImpersonationSessionService,
    {} as TokenBlocklistService,
  );
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  const res = { cookie, clearCookie } as unknown as Response;
  const req = {
    cookies: { [REFRESH_COOKIE_NAME]: 'old-raw-token' },
    headers: {},
  } as unknown as Request;
  return { controller, req, res, cookie, clearCookie };
}

describe('RefreshTokenController.refresh cookie handling', () => {
  afterEach(() => mint.mockReset());

  it('a concurrent-revoke rejection 401s with no Set-Cookie at all', async () => {
    mint.mockResolvedValue(null);
    const { controller, req, res, cookie, clearCookie } = build();

    await expect(controller.refresh(req, res)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect({ set: cookie.mock.calls, cleared: clearCookie.mock.calls }).toEqual(
      { set: [], cleared: [] },
    );
  });

  it('a successful mint sets the rotated cookie exactly once', async () => {
    mint.mockResolvedValue('access.jwt');
    const { controller, req, res, cookie, clearCookie } = build();

    await expect(controller.refresh(req, res)).resolves.toEqual({
      access_token: 'access.jwt',
    });

    expect(cookie).toHaveBeenCalledTimes(1);
    expect(cookie.mock.calls[0]?.[0]).toBe(REFRESH_COOKIE_NAME);
    expect(cookie.mock.calls[0]?.[1]).toBe(ROTATED.rawToken);
    expect(clearCookie).not.toHaveBeenCalled();
  });
});
