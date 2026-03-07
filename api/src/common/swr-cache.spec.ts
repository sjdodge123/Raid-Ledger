import { memorySwr, redisSwr, type MemoryCacheEntry } from './swr-cache';

// Helper to create a fresh in-flight map for each test (module-level map persists across tests)
// We clear it by importing a fresh module in tests that need isolation.

function describeMemorySwr() {
  let cache: Map<string, MemoryCacheEntry<string>>;
  let fetchCount: number;
  const fetcher = jest.fn(() => {
    fetchCount++;
    return Promise.resolve(`value-${fetchCount}`);
  });

  beforeEach(() => {
    cache = new Map();
    fetchCount = 0;
    fetcher.mockClear();
  });

  it('should call fetcher on cache miss and store the result', async () => {
    const result = await memorySwr({
      cache,
      key: 'test',
      ttlMs: 10000,
      fetcher,
    });

    expect(result).toBe('value-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.has('test')).toBe(true);
  });

  it('should return cached data without calling fetcher when fresh', async () => {
    // Prime the cache
    await memorySwr({ cache, key: 'test', ttlMs: 10000, fetcher });
    fetcher.mockClear();

    const result = await memorySwr({
      cache,
      key: 'test',
      ttlMs: 10000,
      fetcher,
    });

    expect(result).toBe('value-1');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('should return stale data and trigger background refresh in stale window', async () => {
    // Manually set a cache entry that's in the stale window
    const now = Date.now();
    cache.set('test', {
      data: 'stale-value',
      staleAt: now - 100, // already stale
      expiresAt: now + 5000, // but not expired
    });

    const result = await memorySwr({
      cache,
      key: 'test',
      ttlMs: 10000,
      fetcher,
    });

    // Should return stale data immediately
    expect(result).toBe('stale-value');
    // Background refresh should have been triggered
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Wait for background refresh to complete
    await new Promise((r) => setTimeout(r, 50));

    // Cache should now have fresh data
    const entry = cache.get('test');
    expect(entry?.data).toBe('value-1');
  });

  it('should call fetcher when cache entry is expired', async () => {
    const now = Date.now();
    cache.set('test', {
      data: 'expired-value',
      staleAt: now - 2000,
      expiresAt: now - 1000, // expired
    });

    const result = await memorySwr({
      cache,
      key: 'test',
      ttlMs: 10000,
      fetcher,
    });

    expect(result).toBe('value-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('should deduplicate concurrent background refreshes', async () => {
    const now = Date.now();
    // Set up stale entry
    cache.set('test', {
      data: 'stale',
      staleAt: now - 100,
      expiresAt: now + 5000,
    });

    // Call memorySwr twice rapidly — should only trigger one refresh
    await memorySwr({ cache, key: 'test', ttlMs: 10000, fetcher });
    await memorySwr({ cache, key: 'test', ttlMs: 10000, fetcher });

    // At most one background refresh should have fired
    // (the second call sees the entry still in stale window but refresh is in-flight)
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
}
describe('memorySwr', () => describeMemorySwr());

function describeRedisSwr() {
  let mockRedis: { get: jest.Mock; setex: jest.Mock };
  let fetchCount: number;
  const fetcher = jest.fn(() => {
    fetchCount++;
    return Promise.resolve({ count: fetchCount });
  });

  beforeEach(() => {
    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue('OK'),
    };
    fetchCount = 0;
    fetcher.mockClear();
  });

  it('should call fetcher on cache miss and store the result', async () => {
    const result = await redisSwr({
      redis: mockRedis,
      key: 'test',
      ttlSec: 300,
      fetcher,
    });

    expect(result).toEqual({ count: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mockRedis.setex).toHaveBeenCalledTimes(1);

    // Verify envelope format
    const storedValue = JSON.parse(mockRedis.setex.mock.calls[0][2] as string);
    expect(storedValue).toHaveProperty('storedAt');
    expect(storedValue).toHaveProperty('data', { count: 1 });
  });

  it('should return cached data without calling fetcher when fresh', async () => {
    const envelope = JSON.stringify({
      storedAt: Date.now(), // just stored — fresh
      data: { count: 99 },
    });
    mockRedis.get.mockResolvedValue(envelope);

    const result = await redisSwr({
      redis: mockRedis,
      key: 'test',
      ttlSec: 300,
      fetcher,
    });

    expect(result).toEqual({ count: 99 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('should return stale data and trigger background refresh', async () => {
    // Stored 250s ago with 300s TTL and 0.2 staleRatio → stale after 240s
    const envelope = JSON.stringify({
      storedAt: Date.now() - 250_000,
      data: { count: 42 },
    });
    mockRedis.get.mockResolvedValue(envelope);

    const result = await redisSwr({
      redis: mockRedis,
      key: 'test',
      ttlSec: 300,
      fetcher,
    });

    // Should return stale data immediately
    expect(result).toEqual({ count: 42 });
    // Background refresh should be triggered
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Wait for background refresh to complete
    await new Promise((r) => setTimeout(r, 50));

    // Redis should have been updated with fresh data
    expect(mockRedis.setex).toHaveBeenCalled();
  });

  it('should handle Redis read errors gracefully', async () => {
    mockRedis.get.mockRejectedValue(new Error('Redis connection lost'));

    const result = await redisSwr({
      redis: mockRedis,
      key: 'test',
      ttlSec: 300,
      fetcher,
    });

    // Should fall through to fetcher
    expect(result).toEqual({ count: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('should handle Redis write errors gracefully', async () => {
    mockRedis.setex.mockRejectedValue(new Error('Redis connection lost'));

    const result = await redisSwr({
      redis: mockRedis,
      key: 'test',
      ttlSec: 300,
      fetcher,
    });

    // Should still return the fetched data
    expect(result).toEqual({ count: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('should handle fetcher failure on background refresh without breaking cache', async () => {
    // Stale data in cache
    const envelope = JSON.stringify({
      storedAt: Date.now() - 250_000,
      data: { count: 42 },
    });
    mockRedis.get.mockResolvedValue(envelope);
    fetcher.mockRejectedValue(new Error('API timeout'));

    const result = await redisSwr({
      redis: mockRedis,
      key: 'test',
      ttlSec: 300,
      fetcher,
    });

    // Should return stale data
    expect(result).toEqual({ count: 42 });

    // Wait for background refresh to settle
    await new Promise((r) => setTimeout(r, 50));

    // Redis should NOT have been updated (refresh failed)
    expect(mockRedis.setex).not.toHaveBeenCalled();
  });
}
describe('redisSwr', () => describeRedisSwr());
