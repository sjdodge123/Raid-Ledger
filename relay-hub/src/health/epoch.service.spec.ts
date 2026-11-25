import { EpochCache } from './epoch.service';

describe('EpochCache (L5)', () => {
  it('returns undefined while the DB is unreachable, then caches the first value', async () => {
    const read = jest
      .fn<Promise<string | undefined>, []>()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce('2026-09-23T00:00:00Z')
      .mockResolvedValue('2099-01-01T00:00:00Z');
    const cache = new EpochCache(read);
    expect(await cache.current()).toBeUndefined();
    expect(await cache.current()).toBe('2026-09-23T00:00:00Z');
    expect(await cache.current()).toBe('2026-09-23T00:00:00Z');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not cache a missing row', async () => {
    const read = jest
      .fn<Promise<string | undefined>, []>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('2026-09-23T00:00:00Z');
    const cache = new EpochCache(read);
    expect(await cache.current()).toBeUndefined();
    expect(await cache.current()).toBe('2026-09-23T00:00:00Z');
  });

  it('gives up after the timeout instead of hanging the canary', async () => {
    const read = jest.fn(() => new Promise<string>(() => undefined));
    const cache = new EpochCache(read, 20);
    expect(await cache.current()).toBeUndefined();
  });
});
