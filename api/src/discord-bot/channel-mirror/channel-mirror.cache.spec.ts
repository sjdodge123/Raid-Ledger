/** ROK-1788 D5 — the single-flight TTL cache in front of every channel read. */
import { ChannelMirrorCache } from './channel-mirror.cache';

describe('ChannelMirrorCache (D5)', () => {
  let clock = 0;
  const cache = (): ChannelMirrorCache<string> =>
    new ChannelMirrorCache<string>(60_000, () => clock);

  beforeEach(() => {
    clock = 1_000;
  });

  it('shares ONE load between concurrent misses', async () => {
    const c = cache();
    const load = jest.fn().mockResolvedValue('v1');
    const [a, b] = await Promise.all([c.get('k', load), c.get('k', load)]);
    expect([a, b]).toEqual(['v1', 'v1']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves the cached value until the TTL expires, then reloads', async () => {
    const c = cache();
    const load = jest
      .fn()
      .mockResolvedValueOnce('v1')
      .mockResolvedValueOnce('v2');
    await c.get('k', load);
    clock += 59_999;
    await expect(c.get('k', load)).resolves.toBe('v1');
    clock += 1;
    await expect(c.get('k', load)).resolves.toBe('v2');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caches a resolved failure state like any other value', async () => {
    const c = new ChannelMirrorCache<{ state: string }>(60_000, () => clock);
    const load = jest.fn().mockResolvedValue({ state: 'no-access' });
    await c.get('k', load);
    await c.get('k', load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejected load and releases the in-flight slot', async () => {
    const c = cache();
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('v2');
    await expect(c.get('k', load)).rejects.toThrow('boom');
    await expect(c.get('k', load)).resolves.toBe('v2');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('clear() forces a fresh load', async () => {
    const c = cache();
    const load = jest
      .fn()
      .mockResolvedValueOnce('v1')
      .mockResolvedValueOnce('v2');
    await c.get('k', load);
    c.clear('k');
    await expect(c.get('k', load)).resolves.toBe('v2');
  });

  it('clear() during a load: callers still get it, but it is not stored', async () => {
    const c = cache();
    const load = jest
      .fn()
      .mockResolvedValueOnce('stale')
      .mockResolvedValueOnce('fresh');
    const pending = c.get('k', load);
    c.clear('k');
    await expect(pending).resolves.toBe('stale');
    await expect(c.get('k', load)).resolves.toBe('fresh');
  });

  it('keeps keys independent', async () => {
    const c = cache();
    const load = jest.fn().mockResolvedValue('v');
    await Promise.all([c.get('a', load), c.get('b', load)]);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
