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

describe('EpochCache single-flight', () => {
  it('shares one in-flight read between concurrent callers', async () => {
    let release: (v: string) => void = () => undefined;
    const read = jest.fn(
      () => new Promise<string>((resolve) => (release = resolve)),
    );
    const cache = new EpochCache(read, 1000);
    const a = cache.current();
    const b = cache.current();
    release('2026-09-23T00:00:00Z');
    expect(await Promise.all([a, b])).toEqual([
      '2026-09-23T00:00:00Z',
      '2026-09-23T00:00:00Z',
    ]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('answers at once, without a new read, while a timed-out read hangs', async () => {
    const read = jest.fn(() => new Promise<string>(() => undefined));
    const cache = new EpochCache(read, 20, 60_000);
    expect(await cache.current()).toBeUndefined();
    expect(await cache.current()).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh read once a hung read is older than retryMs', async () => {
    const read = jest
      .fn<Promise<string | undefined>, []>()
      .mockReturnValueOnce(new Promise<string>(() => undefined))
      .mockResolvedValue('2026-09-23T00:00:00Z');
    const cache = new EpochCache(read, 10, 30);
    expect(await cache.current()).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(await cache.current()).toBe('2026-09-23T00:00:00Z');
    expect(read).toHaveBeenCalledTimes(2);
  });
});
