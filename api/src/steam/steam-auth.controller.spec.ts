import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

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
import { LinkNonceService } from '../auth/link-nonce.service';
import * as crypto from 'crypto';
import type { Response, Request } from 'express';
import type { AuthenticatedExpressRequest } from '../auth/types';

const LINK_EXPIRED_COPY = 'Link request expired. Please try again.';

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
  linkNonce: { consume: jest.Mock };
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
    linkNonce: { consume: jest.fn() },
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
      { provide: LinkNonceService, useValue: mocks.linkNonce },
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
      mocks.linkNonce.consume.mockResolvedValue({ userId: 42 });
      mocks.settings.isSteamConfigured.mockResolvedValue(true);

      const req = createMockRequest({
        headers: { host: 'raid.gamernight.net', 'x-forwarded-proto': 'https' },
      });
      const res = createMockResponse();
      await controller.steamLink('valid-nonce', req, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      expect(extractReturnTo(res)).toContain('/api/auth/steam/link/callback');
    });

    it('omits /api prefix in return_to URL for local dev (no CLIENT_URL)', async () => {
      mocks.config.get.mockImplementation((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret';
        return undefined;
      });
      mocks.linkNonce.consume.mockResolvedValue({ userId: 42 });
      mocks.settings.isSteamConfigured.mockResolvedValue(true);

      const req = createMockRequest({
        protocol: 'http',
        headers: { host: 'localhost:3000' },
      });
      const res = createMockResponse();
      await controller.steamLink('valid-nonce', req, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const returnTo = extractReturnTo(res);
      expect(returnTo).toMatch(
        /^http:\/\/localhost:3000\/auth\/steam\/link\/callback/,
      );
      expect(returnTo).not.toContain('/api/');
    });
  });

  // ROK-941 returnTo now rides in the link nonce (ROK-1630): minted after the
  // allowlist check at POST /link/start, and re-validated here on the GET hop.
  describe('returnTo from the link nonce (ROK-941, ROK-1630)', () => {
    /** Shared setup: a valid nonce for user 42 carrying `returnTo`. */
    function setupValidLinkMocks(returnTo?: string) {
      mocks.config.get.mockImplementation((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret';
        return undefined;
      });
      mocks.linkNonce.consume.mockResolvedValue(
        returnTo === undefined ? { userId: 42 } : { userId: 42, returnTo },
      );
      mocks.settings.isSteamConfigured.mockResolvedValue(true);
    }

    function localReq(query: Record<string, string> = {}): Request {
      return createMockRequest({
        protocol: 'http',
        headers: { host: 'localhost:3000' },
        query,
      });
    }

    it('includes returnTo in signed state when provided', async () => {
      setupValidLinkMocks('/onboarding');
      const res = createMockResponse();

      await controller.steamLink('valid-nonce', localReq(), res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const state = extractStateFromRedirect(res, 'test-secret');
      expect(state).not.toBeNull();
      expect(state!.returnTo).toBe('/onboarding');
    });

    it('validates returnTo against allowlist', async () => {
      setupValidLinkMocks('https://evil.com/phish');
      const res = createMockResponse();

      await controller.steamLink('valid-nonce', localReq(), res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const state = extractStateFromRedirect(res, 'test-secret');
      expect(state).not.toBeNull();
      // Invalid returnTo should be silently replaced with the safe default
      expect(state!.returnTo).toBe('/profile');
    });

    it('defaults returnTo to /profile when not provided', async () => {
      setupValidLinkMocks();
      const res = createMockResponse();

      await controller.steamLink('valid-nonce', localReq(), res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const state = extractStateFromRedirect(res, 'test-secret');
      expect(state).not.toBeNull();
      // When no returnTo is specified, it should default to /profile
      expect(state!.returnTo).toBe('/profile');
    });

    it('ignores a ?returnTo= query param — only the nonce carries it', async () => {
      setupValidLinkMocks();
      const res = createMockResponse();

      await controller.steamLink(
        'valid-nonce',
        localReq({ returnTo: '/onboarding' }),
        res,
      );

      const state = extractStateFromRedirect(res, 'test-secret');
      expect(state).not.toBeNull();
      expect(state!.returnTo).toBe('/profile');
    });

    it('signed state carries userId, action and returnTo for the callback', async () => {
      setupValidLinkMocks('/onboarding');
      const res = createMockResponse();

      await controller.steamLink('valid-nonce', localReq(), res);

      // The callback reads userId + returnTo back out of this state.
      const state = extractStateFromRedirect(res, 'test-secret');
      expect(state).not.toBeNull();
      expect(state!.returnTo).toBe('/onboarding');
      expect(state!.action).toBe('steam_link');
      expect(state!.userId).toBe(42);
    });

    it('rejects returnTo with protocol-relative URLs', async () => {
      setupValidLinkMocks('//evil.com');
      const res = createMockResponse();

      await controller.steamLink('valid-nonce', localReq(), res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const state = extractStateFromRedirect(res, 'test-secret');
      expect(state).not.toBeNull();
      // Protocol-relative URL should be rejected, defaulting to /profile
      expect(state!.returnTo).toBe('/profile');
    });
  });

  describe('GET /auth/steam/link?nonce= (ROK-1630)', () => {
    it('consumes the nonce as a steam-bound nonce', async () => {
      mocks.linkNonce.consume.mockResolvedValue({ userId: 42 });
      mocks.settings.isSteamConfigured.mockResolvedValue(true);

      await controller.steamLink(
        'the-nonce',
        createMockRequest(),
        createMockResponse(),
      );

      expect(mocks.linkNonce.consume).toHaveBeenCalledWith(
        'steam',
        'the-nonce',
      );
    });

    it.each([
      ['a replayed/expired/cross-provider nonce', 'spent-nonce'],
      ['a missing nonce', undefined],
    ])(
      'redirects %s to the error landing, never a JSON 401',
      async (_label, nonce) => {
        mocks.linkNonce.consume.mockResolvedValue(null);
        const res = createMockResponse();

        await controller.steamLink(nonce, createMockRequest(), res);

        expect(res.redirect).toHaveBeenCalledTimes(1);
        expect(res.redirect).toHaveBeenCalledWith(
          `https://raid.gamernight.net/profile/integrations?steam=error&message=${encodeURIComponent(LINK_EXPIRED_COPY)}`,
        );
        expect(res.status).not.toHaveBeenCalled();
        expect(mocks.settings.isSteamConfigured).not.toHaveBeenCalled();
      },
    );

    it('declares @Query("nonce") and no @Query("token")', () => {
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        SteamAuthController,
        'steamLink',
      ) as Record<string, { data?: unknown }>;
      const names = Object.values(args).map((a) => a.data);
      expect(names).toContain('nonce');
      expect(names).not.toContain('token');
    });
  });

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
