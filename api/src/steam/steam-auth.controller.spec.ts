import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SteamAuthController } from './steam-auth.controller';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';
import { SteamService } from './steam.service';
import { SteamWishlistService } from './steam-wishlist.service';
import type { Response, Request } from 'express';

function createMockResponse(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn(),
  } as unknown as Response;
}

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    protocol: 'https',
    headers: { host: 'raid.gamernight.net' },
    query: {},
    ...overrides,
  } as unknown as Request;
}

/** Extract the openid.return_to URL from the redirect call. */
function extractReturnTo(res: Response): string {
  const redirectUrl = (res.redirect as jest.Mock).mock.calls[0][0] as string;
  return new URL(redirectUrl).searchParams.get('openid.return_to')!;
}

interface MockDeps {
  config: { get: jest.Mock };
  jwt: { verify: jest.Mock };
  settings: { isSteamConfigured: jest.Mock };
}

async function createTestController(): Promise<{
  controller: SteamAuthController;
  mocks: MockDeps;
}> {
  const mocks: MockDeps = {
    config: {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret';
        return undefined;
      }),
    },
    jwt: { verify: jest.fn() },
    settings: { isSteamConfigured: jest.fn() },
  };

  const module = await Test.createTestingModule({
    controllers: [SteamAuthController],
    providers: [
      { provide: UsersService, useValue: {} },
      { provide: SettingsService, useValue: mocks.settings },
      { provide: ConfigService, useValue: mocks.config },
      { provide: JwtService, useValue: mocks.jwt },
      { provide: SteamService, useValue: {} },
      { provide: SteamWishlistService, useValue: {} },
    ],
  }).compile();

  return { controller: module.get(SteamAuthController), mocks };
}

describe('SteamAuthController', () => {
  let controller: SteamAuthController;
  let mocks: MockDeps;

  beforeEach(async () => {
    ({ controller, mocks } = await createTestController());
  });

  describe('Regression: ROK-770', () => {
    it('includes /api prefix in return_to URL when CLIENT_URL is set', async () => {
      mocks.config.get.mockImplementation((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret';
        if (key === 'CLIENT_URL') return 'https://raid.gamernight.net';
        return undefined;
      });
      mocks.jwt.verify.mockReturnValue({ sub: 42 });
      mocks.settings.isSteamConfigured.mockResolvedValue(true);

      const req = createMockRequest({
        headers: { host: 'raid.gamernight.net', 'x-forwarded-proto': 'https' },
      });
      const res = createMockResponse();
      await controller.steamLink('valid-token', req, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      expect(extractReturnTo(res)).toContain('/api/auth/steam/link/callback');
    });

    it('omits /api prefix in return_to URL for local dev (no CLIENT_URL)', async () => {
      mocks.config.get.mockImplementation((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret';
        return undefined;
      });
      mocks.jwt.verify.mockReturnValue({ sub: 42 });
      mocks.settings.isSteamConfigured.mockResolvedValue(true);

      const req = createMockRequest({
        protocol: 'http',
        headers: { host: 'localhost:3000' },
      });
      const res = createMockResponse();
      await controller.steamLink('valid-token', req, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const returnTo = extractReturnTo(res);
      expect(returnTo).toMatch(
        /^http:\/\/localhost:3000\/auth\/steam\/link\/callback/,
      );
      expect(returnTo).not.toContain('/api/');
    });
  });
});
