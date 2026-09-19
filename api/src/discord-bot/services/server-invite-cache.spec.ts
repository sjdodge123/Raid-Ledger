import {
  ServerInviteCache,
  SERVER_INVITE_CACHE_MAX,
  SERVER_INVITE_REUSE_MS,
} from './server-invite-cache';

/** A clock the test drives by hand so reuse windows are deterministic. */
function makeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** A mint that hands back a fresh URL on every call so reuse is observable. */
function makeMint(): jest.Mock<Promise<string | null>, []> {
  let n = 0;
  return jest.fn(() => Promise.resolve(`https://discord.gg/invite-${++n}`));
}

describe('ServerInviteCache — reuse within the window (ROK-1631)', () => {
  it('hands the same URL back to the same user for the same event', async () => {
    const mint = makeMint();
    const cache = new ServerInviteCache(makeClock().now);

    const first = await cache.getOrMint(7, 42, mint);
    const second = await cache.getOrMint(7, 42, mint);

    expect(second).toBe(first);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('mints separately for a different user on the same event', async () => {
    const mint = makeMint();
    const cache = new ServerInviteCache(makeClock().now);

    const forSeven = await cache.getOrMint(7, 42, mint);
    const forEight = await cache.getOrMint(8, 42, mint);

    expect(forEight).not.toBe(forSeven);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('mints separately for the same user on a different event', async () => {
    const mint = makeMint();
    const cache = new ServerInviteCache(makeClock().now);

    const forFortyTwo = await cache.getOrMint(7, 42, mint);
    const forNine = await cache.getOrMint(7, 9, mint);

    expect(forNine).not.toBe(forFortyTwo);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('mints again once the reuse window has elapsed', async () => {
    const mint = makeMint();
    const clock = makeClock();
    const cache = new ServerInviteCache(clock.now);

    const first = await cache.getOrMint(7, 42, mint);
    clock.advance(SERVER_INVITE_REUSE_MS + 1);
    const second = await cache.getOrMint(7, 42, mint);

    expect(second).not.toBe(first);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('shares one mint between two concurrent callers', async () => {
    const mint = makeMint();
    const cache = new ServerInviteCache(makeClock().now);

    const [a, b] = await Promise.all([
      cache.getOrMint(7, 42, mint),
      cache.getOrMint(7, 42, mint),
    ]);

    expect(a).toBe(b);
    expect(mint).toHaveBeenCalledTimes(1);
  });
});

describe('ServerInviteCache — failures are not remembered (ROK-1631)', () => {
  it('retries after a mint that produced no URL', async () => {
    const mint = jest
      .fn<Promise<string | null>, []>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('https://discord.gg/later');
    const cache = new ServerInviteCache(makeClock().now);

    expect(await cache.getOrMint(7, 42, mint)).toBeNull();
    expect(await cache.getOrMint(7, 42, mint)).toBe('https://discord.gg/later');
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('propagates a rejection and retries on the next call', async () => {
    const mint = jest
      .fn<Promise<string | null>, []>()
      .mockRejectedValueOnce(new Error('discord said no'))
      .mockResolvedValueOnce('https://discord.gg/later');
    const cache = new ServerInviteCache(makeClock().now);

    await expect(cache.getOrMint(7, 42, mint)).rejects.toThrow(
      'discord said no',
    );
    expect(await cache.getOrMint(7, 42, mint)).toBe('https://discord.gg/later');
    expect(mint).toHaveBeenCalledTimes(2);
  });
});

describe('ServerInviteCache — bounded memory (ROK-1631)', () => {
  it('evicts the oldest entry once the cap is reached', async () => {
    const mint = makeMint();
    const cache = new ServerInviteCache(makeClock().now);

    for (let userId = 1; userId <= SERVER_INVITE_CACHE_MAX; userId++) {
      await cache.getOrMint(userId, 42, mint);
    }
    expect(mint).toHaveBeenCalledTimes(SERVER_INVITE_CACHE_MAX);

    // One past the cap pushes the oldest key (user 1) out...
    await cache.getOrMint(SERVER_INVITE_CACHE_MAX + 1, 42, mint);
    expect(mint).toHaveBeenCalledTimes(SERVER_INVITE_CACHE_MAX + 1);

    // ...so the evicted user has to mint a second time, while a user that
    // survived the eviction is still served from the cache.
    await cache.getOrMint(1, 42, mint);
    expect(mint).toHaveBeenCalledTimes(SERVER_INVITE_CACHE_MAX + 2);

    await cache.getOrMint(SERVER_INVITE_CACHE_MAX, 42, mint);
    expect(mint).toHaveBeenCalledTimes(SERVER_INVITE_CACHE_MAX + 2);
  });

  it('drops entries that aged out rather than counting them to the cap', async () => {
    const mint = makeMint();
    const clock = makeClock();
    const cache = new ServerInviteCache(clock.now);

    for (let userId = 1; userId <= SERVER_INVITE_CACHE_MAX; userId++) {
      await cache.getOrMint(userId, 42, mint);
    }
    clock.advance(SERVER_INVITE_REUSE_MS + 1);

    // Every entry is stale, so the newcomer evicts on age, not on the cap.
    const fresh = await cache.getOrMint(SERVER_INVITE_CACHE_MAX + 1, 42, mint);
    expect(fresh).toBe(
      `https://discord.gg/invite-${SERVER_INVITE_CACHE_MAX + 1}`,
    );
    expect(await cache.getOrMint(SERVER_INVITE_CACHE_MAX + 1, 42, mint)).toBe(
      fresh,
    );
    expect(mint).toHaveBeenCalledTimes(SERVER_INVITE_CACHE_MAX + 1);
  });
});
