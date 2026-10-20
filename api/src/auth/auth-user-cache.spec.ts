import {
  authUserEpoch,
  getCachedAuthUser,
  setCachedAuthUser,
  invalidateAuthUser,
  clearAuthUserCache,
  AUTH_USER_CACHE_TTL_MS,
} from './auth-user-cache';

afterEach(() => clearAuthUserCache());

describe('auth-user-cache', () => {
  const userData = {
    role: 'member' as const,
    discordId: 'discord-123',
    deactivatedAt: null,
    kickedAt: null,
    bannedAt: null,
    banReason: null,
    tokenVersion: 0,
  };

  it('returns null on cache miss', () => {
    expect(getCachedAuthUser(1)).toBeNull();
  });

  it('returns cached data after set', () => {
    setCachedAuthUser(1, userData);
    expect(getCachedAuthUser(1)).toEqual(userData);
  });

  it('returns null after invalidation', () => {
    setCachedAuthUser(1, userData);
    invalidateAuthUser(1);
    expect(getCachedAuthUser(1)).toBeNull();
  });

  it('does not affect other user entries on invalidation', () => {
    const otherData = {
      role: 'admin' as const,
      discordId: 'discord-456',
      deactivatedAt: null,
      kickedAt: null,
      bannedAt: null,
      banReason: null,
      tokenVersion: 0,
    };
    setCachedAuthUser(1, userData);
    setCachedAuthUser(2, otherData);

    invalidateAuthUser(1);

    expect(getCachedAuthUser(1)).toBeNull();
    expect(getCachedAuthUser(2)).toEqual(otherData);
  });

  it('returns null after entry expires', () => {
    jest.useFakeTimers();
    try {
      setCachedAuthUser(1, userData);
      expect(getCachedAuthUser(1)).toEqual(userData);

      jest.advanceTimersByTime(AUTH_USER_CACHE_TTL_MS + 1);
      expect(getCachedAuthUser(1)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns data before TTL expires', () => {
    jest.useFakeTimers();
    try {
      setCachedAuthUser(1, userData);
      jest.advanceTimersByTime(AUTH_USER_CACHE_TTL_MS - 1);
      expect(getCachedAuthUser(1)).toEqual(userData);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clearAuthUserCache removes all entries', () => {
    setCachedAuthUser(1, userData);
    setCachedAuthUser(2, {
      role: 'admin',
      discordId: null,
      deactivatedAt: null,
      kickedAt: null,
      bannedAt: null,
      banReason: null,
      tokenVersion: 0,
    });

    clearAuthUserCache();

    expect(getCachedAuthUser(1)).toBeNull();
    expect(getCachedAuthUser(2)).toBeNull();
  });

  it('parallel requests for the same user share cached result', () => {
    setCachedAuthUser(1, userData);

    const results = Array.from({ length: 10 }, () => getCachedAuthUser(1));

    results.forEach((result) => expect(result).toEqual(userData));
  });

  describe('ROK-1823 stale-cache guard (invalidation epoch)', () => {
    it('drops a load that started before an invalidation of that user', () => {
      const loadEpoch = authUserEpoch(1);
      invalidateAuthUser(1); // e.g. a token-version bump committed mid-load
      setCachedAuthUser(1, userData, loadEpoch);
      expect(getCachedAuthUser(1)).toBeNull();
    });

    it('caches a load when no invalidation ran meanwhile', () => {
      const loadEpoch = authUserEpoch(1);
      setCachedAuthUser(1, userData, loadEpoch);
      expect(getCachedAuthUser(1)).toEqual(userData);
    });

    it('caches a load that started AFTER the invalidation', () => {
      invalidateAuthUser(1);
      const loadEpoch = authUserEpoch(1);
      setCachedAuthUser(1, userData, loadEpoch);
      expect(getCachedAuthUser(1)).toEqual(userData);
    });

    it("another user's invalidation does not drop the load", () => {
      const loadEpoch = authUserEpoch(1);
      invalidateAuthUser(2);
      setCachedAuthUser(1, userData, loadEpoch);
      expect(getCachedAuthUser(1)).toEqual(userData);
    });

    it('drops a load that straddles clearAuthUserCache', () => {
      const loadEpoch = authUserEpoch(1);
      clearAuthUserCache();
      setCachedAuthUser(1, userData, loadEpoch);
      expect(getCachedAuthUser(1)).toBeNull();
    });
  });
});
