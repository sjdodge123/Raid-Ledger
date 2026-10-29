import { ServiceUnavailableException } from '@nestjs/common';
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

  it('rejects with 503 once the waiter queue is full', async () => {
    const cache = new ValheimMapMaskCache({
      budgetBytes: 1000,
      concurrency: 1,
      maxWaiters: 1,
    });
    const gate = deferred();
    const first = cache.get('k0', () => gate.promise);
    const queued = cache.get('k1', () => Promise.resolve(Buffer.from('1')));
    await flush();
    await expect(
      cache.get('k2', () => Promise.resolve(Buffer.from('2'))),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    gate.resolve(Buffer.from('0'));
    await expect(first).resolves.toEqual(Buffer.from('0'));
    await expect(queued).resolves.toEqual(Buffer.from('1'));
  });

  it('settles every get under load — rejects, throws and 503s leak no permit', async () => {
    const cache = new ValheimMapMaskCache({
      budgetBytes: 1000,
      concurrency: 2,
      maxWaiters: 4,
    });
    const produce = (i: number) => async (): Promise<Buffer> => {
      await flush();
      if (i % 3 === 0) throw new Error(`render ${i} failed`);
      return Buffer.from(String(i));
    };
    const all = Array.from({ length: 10 }, (_, i) =>
      cache.get(`k${i}`, produce(i)),
    );
    const settled = await Promise.allSettled(all);
    const kinds = settled.map((r) =>
      r.status === 'fulfilled'
        ? 'ok'
        : r.reason instanceof ServiceUnavailableException
          ? 'busy'
          : 'err',
    );
    expect(kinds.filter((k) => k === 'busy')).toHaveLength(4);
    // Every permit came back: the next render starts immediately.
    let ran = false;
    await cache.get('after', () => {
      ran = true;
      return Promise.resolve(Buffer.from('a'));
    });
    expect(ran).toBe(true);
  });
});
