/**
 * ROK-1941 (Codex P2) — the one process-wide pool every hub media download
 * + sharp job goes through: never more than `limit` in flight, a bounded
 * queue for droppable (live gateway) work, essential work always queued.
 */
import {
  HubMediaIngestPool,
  HubMediaIngestQueueFullError,
  readIngestPoolLimits,
} from './hub-media-ingest.pool';

/** A task the spec releases by hand, recording peak concurrency. */
function gate(counter: { now: number; peak: number }) {
  let release: () => void = () => undefined;
  const done = new Promise<void>((r) => (release = r));
  const work = async (): Promise<number> => {
    counter.now += 1;
    counter.peak = Math.max(counter.peak, counter.now);
    await done;
    counter.now -= 1;
    return counter.peak;
  };
  return { work, release: () => release() };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

describe('HubMediaIngestPool', () => {
  it('never runs more than the limit at once and runs every queued task', async () => {
    const pool = new HubMediaIngestPool({ limit: 2, queueMax: 10 });
    const counter = { now: 0, peak: 0 };
    const gates = Array.from({ length: 7 }, () => gate(counter));
    const runs = gates.map((g, i) => pool.run(`t${i}`, g.work));
    for (const g of gates) {
      await flush();
      expect(counter.now).toBeLessThanOrEqual(2);
      g.release();
    }
    await Promise.all(runs);
    expect(counter.peak).toBe(2);
    expect(pool.inFlight()).toBe(0);
  });

  it('refuses droppable work once the queue is full, but still queues essential work', async () => {
    const pool = new HubMediaIngestPool({ limit: 1, queueMax: 1 });
    const counter = { now: 0, peak: 0 };
    const [a, b, c] = [gate(counter), gate(counter), gate(counter)];
    const runA = pool.run('a', a.work);
    const runB = pool.run('b', b.work);
    await expect(pool.run('dropped', async () => 1)).rejects.toBeInstanceOf(
      HubMediaIngestQueueFullError,
    );
    const runC = pool.run('c', c.work, 'essential');
    for (const g of [a, b, c]) {
      await flush();
      g.release();
    }
    await Promise.all([runA, runB, runC]);
    expect(counter.peak).toBe(1);
  });

  it('frees the slot when a task throws', async () => {
    const pool = new HubMediaIngestPool({ limit: 1, queueMax: 5 });
    await expect(
      pool.run('boom', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    await expect(pool.run('next', async () => 'ok')).resolves.toBe('ok');
    expect(pool.inFlight()).toBe(0);
  });

  it('reads positive-integer env overrides, else the defaults', () => {
    expect(readIngestPoolLimits({})).toEqual({ limit: 2, queueMax: 50 });
    expect(
      readIngestPoolLimits({
        HUB_MEDIA_INGEST_CONCURRENCY: '3',
        HUB_MEDIA_INGEST_QUEUE_MAX: 'nope',
      }),
    ).toEqual({ limit: 3, queueMax: 50 });
  });
});
