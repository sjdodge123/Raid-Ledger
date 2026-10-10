/**
 * ROK-1762 — real-Redis proof for clearFinishedJob.
 *
 * Proves on the INSTALLED BullMQ version that a fixed-jobId `add` is a silent
 * no-op while a retained completed/failed job holds the id (the bug), that
 * `clearFinishedJob` makes the same add schedule a fresh job (the fix), and
 * that pending (waiting / delayed) jobs are NOT removed.
 *
 * Uses scratch queues under the suite's BULLMQ_KEY_PREFIX on their own
 * connections, so no app processor competes for the jobs. Obliterated in
 * afterAll.
 */
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { clearFinishedJob } from './clear-finished-job.helpers';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const PREFIX = process.env.BULLMQ_KEY_PREFIX ?? 'test-rok1762';
const RUN = `${process.pid}-${Date.now()}`;
const ONE_HOUR_MS = 60 * 60 * 1000;

type Outcome = 'completed' | 'failed';

function newConnection(): Redis {
  return new Redis(REDIS_URL, { maxRetriesPerRequest: null });
}

describe('clearFinishedJob against real Redis (ROK-1762)', () => {
  const connections: Redis[] = [];
  let queue: Queue;
  let idleQueue: Queue;
  let worker: Worker;

  beforeAll(() => {
    const [q, w, idle] = [newConnection(), newConnection(), newConnection()];
    connections.push(q, w, idle);
    queue = new Queue(`rok1762-finished-${RUN}`, { connection: q, prefix: PREFIX });
    // No worker on this queue: its jobs stay waiting/delayed for the test.
    idleQueue = new Queue(`rok1762-idle-${RUN}`, { connection: idle, prefix: PREFIX });
    worker = new Worker(
      queue.name,
      (job: Job) => {
        if (job.name === 'fail') throw new Error('rok-1762 seeded failure');
        return Promise.resolve('ok');
      },
      { connection: w, prefix: PREFIX },
    );
  });

  afterAll(async () => {
    await worker.close();
    await queue.obliterate({ force: true });
    await idleQueue.obliterate({ force: true });
    await queue.close();
    await idleQueue.close();
    await Promise.all(connections.map((c) => c.quit()));
  });

  /** Resolve once the worker has moved `jobId` into the terminal `outcome`. */
  function workerFinished(jobId: string, outcome: Outcome): Promise<void> {
    return new Promise((resolve) => {
      const onEvent = (job: Job | undefined) => {
        if (job?.id !== jobId) return;
        worker.off(outcome, onEvent);
        resolve();
      };
      worker.on(outcome, onEvent);
    });
  }

  /** Seed a retained finished job the way prod retention leaves one. */
  async function seedFinished(jobId: string, outcome: Outcome): Promise<void> {
    const done = workerFinished(jobId, outcome);
    const name = outcome === 'failed' ? 'fail' : 'ok';
    await queue.add(name, {}, {
      jobId, attempts: 1, removeOnComplete: 100, removeOnFail: 50,
    });
    await done;
    expect(await queue.getJobState(jobId)).toBe(outcome);
  }

  /** The fixed-jobId enqueue every affected site performs. */
  function reAdd(jobId: string) {
    return queue.add('ok', { rerun: true }, {
      jobId, delay: ONE_HOUR_MS, removeOnComplete: 100, removeOnFail: 50,
    });
  }

  it.each<Outcome>(['completed', 'failed'])(
    'BUG: a same-id add is a silent no-op while a %s job is retained',
    async (outcome) => {
      const jobId = `bug-${outcome}`;
      await seedFinished(jobId, outcome);

      await reAdd(jobId);

      // Still the retained finished job — nothing new was scheduled.
      expect(await queue.getJobState(jobId)).toBe(outcome);
      expect(await queue.getDelayedCount()).toBe(0);
    },
  );

  it.each<Outcome>(['completed', 'failed'])(
    'FIX: clearing a retained %s job lets the same-id add schedule',
    async (outcome) => {
      const jobId = `fix-${outcome}`;
      await seedFinished(jobId, outcome);

      expect(await clearFinishedJob(queue, jobId)).toBe(outcome);
      await reAdd(jobId);

      expect(await queue.getJobState(jobId)).toBe('delayed');
      const job = await queue.getJob(jobId);
      expect(job?.data).toEqual({ rerun: true });
      await queue.remove(jobId);
    },
  );

  it.each([
    ['delayed', ONE_HOUR_MS],
    ['waiting', 0],
  ] as const)('leaves a %s job in place', async (state, delay) => {
    const jobId = `pending-${state}`;
    await idleQueue.add('ok', { original: true }, { jobId, delay });
    expect(await idleQueue.getJobState(jobId)).toBe(state);

    expect(await clearFinishedJob(idleQueue, jobId)).toBe(state);

    expect(await idleQueue.getJobState(jobId)).toBe(state);
    const job = await idleQueue.getJob(jobId);
    expect(job?.data).toEqual({ original: true });
  });

  it('reports missing for an id no job holds', async () => {
    await expect(clearFinishedJob(queue, 'never-added')).resolves.toBe('missing');
  });
});
