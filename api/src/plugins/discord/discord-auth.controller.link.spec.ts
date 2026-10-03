/**
 * ROK-1630: GET /auth/discord/link takes a single-use `?nonce=` minted by
 * POST /auth/discord/link/start, never a `?token=<access JWT>`. Every miss is
 * the same 302 to the profile error landing (D7) — no JSON 401 dead-end.
 */
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Request, Response } from 'express';
import { DiscordAuthController } from './discord-auth.controller';
import { verifyOAuthState } from './discord-auth.helpers';
import { AuthService } from '../../auth/auth.service';
import { UsersService } from '../../users/users.service';
import { SettingsService } from '../../settings/settings.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { RefreshTokenService } from '../../auth/refresh/refresh-token.service';
import { LinkNonceService } from '../../auth/link-nonce.service';

const SECRET = 'test-secret';
const CLIENT_URL = 'https://raid.test';
const LINK_EXPIRED_COPY = 'Link request expired. Please try again.';

interface Mocks {
  consume: jest.Mock;
  getDiscordOAuthConfig: jest.Mock;
}

async function build(): Promise<{ ctrl: DiscordAuthController; m: Mocks }> {
  const m: Mocks = { consume: jest.fn(), getDiscordOAuthConfig: jest.fn() };
  const config = {
    get: (k: string) => ({ JWT_SECRET: SECRET, CLIENT_URL })[k],
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [DiscordAuthController],
    providers: [
      { provide: AuthService, useValue: {} },
      { provide: UsersService, useValue: {} },
      { provide: ConfigService, useValue: config },
      { provide: SettingsService, useValue: m },
      { provide: REDIS_CLIENT, useValue: {} },
      { provide: EventEmitter2, useValue: {} },
      { provide: RefreshTokenService, useValue: {} },
      { provide: LinkNonceService, useValue: { consume: m.consume } },
    ],
  }).compile();
  return { ctrl: moduleRef.get(DiscordAuthController), m };
}

function mockRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn(),
  } as unknown as Response;
}

const req = { headers: { host: 'raid.test' }, query: {} } as unknown as Request;

function redirectedTo(res: Response): string {
  const calls = (res.redirect as jest.Mock).mock.calls as string[][];
  expect(calls).toHaveLength(1);
  return calls[0][0];
}

describe('DiscordAuthController — GET /auth/discord/link?nonce= (ROK-1630)', () => {
  let ctrl: DiscordAuthController;
  let m: Mocks;

  beforeEach(async () => {
    ({ ctrl, m } = await build());
    m.getDiscordOAuthConfig.mockResolvedValue({
      clientId: 'cid',
      clientSecret: 'shh',
      callbackUrl: 'https://raid.test/api/auth/discord/callback',
    });
  });

  it('a valid nonce 302s to Discord with a signed link state for its user', async () => {
    m.consume.mockResolvedValue({ userId: 7 });
    const res = mockRes();

    await ctrl.discordLink('good-nonce', req, res);

    expect(m.consume).toHaveBeenCalledWith('discord', 'good-nonce');
    const url = new URL(redirectedTo(res));
    expect(url.host).toBe('discord.com');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://raid.test/api/auth/discord/link/callback',
    );
    const state = verifyOAuthState(
      url.searchParams.get('state')!,
      SECRET,
      new Logger('test'),
    );
    expect(state).toMatchObject({ userId: 7, action: 'link' });
  });

  it.each([
    ['a replayed/expired/cross-provider nonce', 'spent-nonce'],
    ['a missing nonce', undefined],
  ])(
    'redirects %s to the error landing, never a JSON 401',
    async (_label, nonce) => {
      m.consume.mockResolvedValue(null);
      const res = mockRes();

      await ctrl.discordLink(nonce, req, res);

      expect(redirectedTo(res)).toBe(
        `${CLIENT_URL}/profile/integrations?linked=error&message=${encodeURIComponent(LINK_EXPIRED_COPY)}`,
      );
      expect(res.status).not.toHaveBeenCalled();
      expect(m.getDiscordOAuthConfig).not.toHaveBeenCalled();
    },
  );

  it('declares @Query("nonce") and no @Query("token")', () => {
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      DiscordAuthController,
      'discordLink',
    ) as Record<string, { data?: unknown }>;
    const names = Object.values(args).map((a) => a.data);
    expect(names).toContain('nonce');
    expect(names).not.toContain('token');
  });
});
