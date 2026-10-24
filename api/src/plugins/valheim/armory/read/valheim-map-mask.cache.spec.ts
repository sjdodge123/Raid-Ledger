import { ValheimMapMaskCache } from './valheim-map-mask.cache';

function deferred(): {
  promise: Promise<Buffer>;
  resolve: (b: Buffer) => void;
  reject: (e: Error) => void;
} {
  let resolve: (b: Buffer) => void = () => undefined;
  let reject: (e: Error) => void = () => undefined;
  const promise = new Promise<Buffer>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

describe('ValheimMapMaskCache', () => {
  it('serves a hit without calling the producer again', async () => {
    const cache = new ValheimMapMaskCache({
      budgetBytes: 1000,
      concurrency: 2,
    });
    const produce = jest.fn(() => Promise.resolve(Buffer.alloc(10)));
    await cache.get('k', produce);
    await cache.get('k', produce);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('evicts the least-recently-used entry past the byte budget', async () => {
    const cache = new ValheimMapMaskCache({
      budgetBytes: 1000,
      concurrency: 2,
    });
    const buf = () => Promise.resolve(Buffer.alloc(240));
    for (const k of ['a', 'b', 'c', 'd']) await cache.get(k, buf);
    await cache.get('a', buf); // touch a → b is now oldest
    await cache.get('e', buf);
    expect(cache.stats()).toEqual({ entries: 4, bytes: 960 });
    const produceB = jest.fn(buf);
    const produceA = jest.fn(buf);
    await cache.get('a', produceA);
    expect(produceA).not.toHaveBeenCalled();
    await cache.get('b', produceB);
    expect(produceB).toHaveBeenCalledTimes(1);
  });

  it('returns but does not store an entry over a quarter of the budget', async () => {
    const cache = new ValheimMapMaskCache({
      budgetBytes: 1000,
      concurrency: 2,
    });
    const out = await cache.get('big', () =>
      Promise.resolve(Buffer.alloc(251)),
    );
    expect(out.length).toBe(251);
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
  });

  it('dedups concurrent gets of one key onto one producer call', async () => {
    const cache = new ValheimMapMaskCache({
      budgetBytes: 1000,
      concurrency: 2,
    });
    const d = deferred();
    const produce = jest.fn(() => d.promise);
    const p1 = cache.get('k', produce);
    const p2 = cache.get('k', produce);
    d.resolve(Buffer.from('x'));
    await expect(Promise.all([p1, p2])).resolves.toEqual([
      Buffer.from('x'),
      Buffer.from('x'),
    ]);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('never caches a rejected render; the next get retries', async () => {
    const cache = new ValheimMapMaskCache({
      budgetBytes: 1000,
      concurrency: 2,
    });
    await expect(
      cache.get('k', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    const retry = jest.fn(() => Promise.resolve(Buffer.from('ok')));
    await expect(cache.get('k', retry)).resolves.toEqual(Buffer.from('ok'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('runs at most 2 producers at once', async () => {
    const cache = new ValheimMapMaskCache({
      budgetBytes: 1000,
      concurrency: 2,
    });
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const all = gates.map((g, i) =>
      cache.get(`k${i}`, async () => {
        started.push(i);
        running += 1;
        peak = Math.max(peak, running);
        const out = await g.promise;
        running -= 1;
        return out;
      }),
    );
    await flush();
    expect(started).toEqual([0, 1]);
    gates[0]?.resolve(Buffer.from('0'));
    await flush();
    expect(started).toEqual([0, 1, 2]);
    gates.slice(1).forEach((g) => g.resolve(Buffer.from('y')));
    await Promise.all(all);
    expect(peak).toBe(2);
  });
});
