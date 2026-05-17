import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

// Sentry's nestjs export wraps `setUser` in a non-redefinable proxy that
// `jest.spyOn(Sentry, 'setUser')` cannot replace. Hoisted `jest.mock` lets
// us intercept the call without touching the live binding.
const setUserMock = jest.fn();
jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual('@sentry/nestjs'),
  setUser: (...args: unknown[]) => setUserMock(...args),
}));

import { SteamAuthController } from './steam-auth.controller';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';
import { SteamService } from './steam.service';
import { SteamWishlistService } from './steam-wishlist.service';
import * as crypto from 'crypto';
import type { Response, Request } from 'express';
import type { AuthenticatedExpressRequest } from '../auth/types';

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

/**
 * Extract the signed state from the callback URL embedded in the redirect.
 * The state is in the openid.return_to URL's `state` query param.
 */
function extractStateFromRedirect(
  res: Response,
  jwtSecret: string,
): Record<string, unknown> | null {
  const returnToUrl = extractReturnTo(res);
  const stateParam = new URL(returnToUrl).searchParams.get('state');
  if (!stateParam) return null;
  try {
    const { data, signature } = JSON.parse(
      Buffer.from(stateParam, 'base64').toString(),
    ) as { data: string; signature: string };
    const expected = crypto
      .createHmac('sha256', jwtSecret)
      .update(data)
      .digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
      return null;
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface MockDeps {
  config: { get: jest.Mock };
  jwt: { verify: jest.Mock };
  settings: { isSteamConfigured: jest.Mock };
  steam: { syncLibrary: jest.Mock };
  wishlist: { syncWishlist: jest.Mock };
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
    steam: { syncLibrary: jest.fn() },
    wishlist: { syncWishlist: jest.fn() },
  };

  const module = await Test.createTestingModule({
    controllers: [SteamAuthController],
    providers: [
      { provide: UsersService, useValue: {} },
      { provide: SettingsService, useValue: mocks.settings },
      { provide: ConfigService, useValue: mocks.config },
      { provide: JwtService, useValue: mocks.jwt },
      { provide: SteamService, useValue: mocks.steam },
      { provide: SteamWishlistService, useValue: mocks.wishlist },
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

  describe('returnTo query parameter (ROK-941)', () => {
    /** Shared setup: configure mocks for a valid Steam link request. */
    function setupValidLinkMocks() {
      mocks.config.get.mockImplementation((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret';
        return undefined;
      });
      mocks.jwt.verify.mockReturnValue({ sub: 42 });
      mocks.settings.isSteamConfigured.mockResolvedValue(true);
    }

    it('includes returnTo in signed state when provided', async () => {
      setupValidLinkMocks();
      const req = createMockRequest({
        protocol: 'http',
        headers: { host: 'localhost:3000' },
        query: { token: 'valid-token', returnTo: '/onboarding' },
      });
      const res = createMockResponse();

      await controller.steamLink('valid-token', req, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const state = extractStateFromRedirect(res, 'test-secret');
      expect(state).not.toBeNull();
      expect(state!.returnTo).toBe('/onboarding');
    });

    it('validates returnTo against allowlist', async () => {
      setupValidLinkMocks();
      const req = createMockRequest({
        protocol: 'http',
        headers: { host: 'localhost:3000' },
        query: { token: 'valid-token', returnTo: 'https://evil.com/phish' },
      });
      const res = createMockResponse();

      await controller.steamLink('valid-token', req, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const state = extractStateFromRedirect(res, 'test-secret');
      expect(state).not.toBeNull();
      // Invalid returnTo should be silently replaced with the safe default
      expect(state!.returnTo).toBe('/profile');
    });

    it('defaults returnTo to /profile when not provided', async () => {
      setupValidLinkMocks();
      const req = createMockRequest({
        protocol: 'http',
        headers: { host: 'localhost:3000' },
      });
      const res = createMockResponse();

      await controller.steamLink('valid-token', req, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const state = extractStateFromRedirect(res, 'test-secret');
      expect(state).not.toBeNull();
      // When no returnTo is specified, it should default to /profile
      expect(state!.returnTo).toBe('/profile');
    });

    it('callback uses returnTo from state for redirect', async () => {
      setupValidLinkMocks();

      // Build a signed state with returnTo included
      // We need to invoke steamLink with returnTo, then use the state
      // in a callback. Since we can't easily test the callback in unit
      // tests (it calls verifySteamOpenId), we verify the redirect path
      // in the signed state is propagated.
      const req = createMockRequest({
        protocol: 'http',
        headers: { host: 'localhost:3000' },
        query: { token: 'valid-token', returnTo: '/onboarding' },
      });
      const res = createMockResponse();

      await controller.steamLink('valid-token', req, res);

      // Extract the state to verify returnTo is persisted for the callback
      const state = extractStateFromRedirect(res, 'test-secret');
      expect(state).not.toBeNull();
      expect(state!.returnTo).toBe('/onboarding');
      expect(state!.action).toBe('steam_link');
      expect(state!.userId).toBe(42);
    });

    it('rejects returnTo with protocol-relative URLs', async () => {
      setupValidLinkMocks();
      const req = createMockRequest({
        protocol: 'http',
        headers: { host: 'localhost:3000' },
        query: { token: 'valid-token', returnTo: '//evil.com' },
      });
      const res = createMockResponse();

      await controller.steamLink('valid-token', req, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const state = extractStateFromRedirect(res, 'test-secret');
      expect(state).not.toBeNull();
      // Protocol-relative URL should be rejected, defaulting to /profile
      expect(state!.returnTo).toBe('/profile');
    });
  });

  // ROK-1307 AC-3: tag every Sentry event with the acting userId so when
  // ANY Steam-sync exception (a 4xx that slips past the filter, or a real
  // 5xx) reaches Sentry, the inbox row is attributed to the user instead
  // of anonymous.
  describe('ROK-1307 AC-3: Sentry.setUser on sync endpoints', () => {
    function fakeRequest(userId: number): AuthenticatedExpressRequest {
      return {
        user: { id: userId },
      } as unknown as AuthenticatedExpressRequest;
    }

    beforeEach(() => {
      setUserMock.mockClear();
    });

    it('calls Sentry.setUser with the requesting user id before syncLibrary', async () => {
      mocks.steam.syncLibrary.mockResolvedValue({
        totalOwned: 0,
        matched: 0,
        newInterests: 0,
        updatedPlaytime: 0,
      });

      await controller.syncLibrary(fakeRequest(42));

      expect(setUserMock).toHaveBeenCalledWith({ id: '42' });
      // Ordering: setUser must run BEFORE the sync service is invoked.
      const setUserOrder = setUserMock.mock.invocationCallOrder[0];
      const syncOrder = mocks.steam.syncLibrary.mock.invocationCallOrder[0];
      expect(setUserOrder).toBeLessThan(syncOrder);
    });

    it('calls Sentry.setUser with the requesting user id before syncWishlist', async () => {
      mocks.wishlist.syncWishlist.mockResolvedValue({
        totalWishlisted: 0,
        matched: 0,
        newInterests: 0,
        removed: 0,
      });

      await controller.syncWishlist(fakeRequest(99));

      expect(setUserMock).toHaveBeenCalledWith({ id: '99' });
      const setUserOrder = setUserMock.mock.invocationCallOrder[0];
      const syncOrder = mocks.wishlist.syncWishlist.mock.invocationCallOrder[0];
      expect(setUserOrder).toBeLessThan(syncOrder);
    });

    it('still calls Sentry.setUser when syncLibrary throws (try/catch preserved)', async () => {
      mocks.steam.syncLibrary.mockRejectedValue(new Error('boom'));

      await expect(controller.syncLibrary(fakeRequest(7))).rejects.toThrow(
        'boom',
      );
      expect(setUserMock).toHaveBeenCalledWith({ id: '7' });
    });
  });
});
