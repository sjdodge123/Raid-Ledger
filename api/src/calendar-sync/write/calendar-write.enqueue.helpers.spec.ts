import { CALENDAR_WRITE_QUEUE } from '../calendar-sync.constants';
import {
  enqueueCalendarWriteJob,
  type CalendarWriteJobData,
  type CalendarWriteQueue,
} from './calendar-write.enqueue.helpers';

interface FakeJob {
  state: string;
}

/**
 * In-memory stand-in for the BullMQ calls the helper makes. Like BullMQ, an
 * `add` whose jobId already exists (in any state) is ignored.
 */
class FakeWriteQueue {
  readonly jobs = new Map<string, FakeJob>();
  readonly added: Array<{
    name: string;
    data: unknown;
    opts: Record<string, unknown>;
  }> = [];
  readonly removed: string[] = [];

  seed(jobId: string, state: string): void {
    this.jobs.set(jobId, { state });
  }

  getJob(jobId: string) {
    const job = this.jobs.get(jobId);
    return Promise.resolve(
      job ? { getState: () => Promise.resolve(job.state) } : undefined,
    );
  }

  add(name: string, data: unknown, opts: Record<string, unknown>) {
    this.added.push({ name, data, opts });
    const id = opts.jobId as string;
    if (!this.jobs.has(id)) {
      this.jobs.set(id, { state: opts.delay ? 'delayed' : 'waiting' });
    }
    return Promise.resolve({ id });
  }

  remove(jobId: string) {
    this.removed.push(jobId);
    return Promise.resolve(this.jobs.delete(jobId) ? 1 : 0);
  }
}

const RECONCILE: CalendarWriteJobData = {
  kind: 'reconcile',
  connectionId: 7,
  eventId: 42,
  userId: 3,
};
const WRITE_OFF: CalendarWriteJobData = { kind: 'write-off', connectionId: 7 };
const DISCONNECT: CalendarWriteJobData = {
  kind: 'disconnect',
  connectionId: 7,
};

function setup(enabled = true) {
  const queue = new FakeWriteQueue();
  const isSyncEnabled = jest.fn(() => Promise.resolve(enabled));
  const deps = { queue: queue as unknown as CalendarWriteQueue, isSyncEnabled };
  return {
    queue,
    isSyncEnabled,
    enqueue: (d: CalendarWriteJobData) => enqueueCalendarWriteJob(deps, d),
  };
}

describe('enqueueCalendarWriteJob — new jobs', () => {
  it('queue name is calendar-write', () => {
    expect(CALENDAR_WRITE_QUEUE).toBe('calendar-write');
  });

  it('reconcile: fixed id, 5s debounce, retry policy, ids-only payload', async () => {
    const { queue, enqueue } = setup();
    await expect(enqueue(RECONCILE)).resolves.toEqual({
      outcome: 'added',
      jobId: 'cal-write-7-42-3',
    });
    expect(queue.added).toEqual([
      {
        name: 'reconcile',
        data: RECONCILE,
        opts: {
          jobId: 'cal-write-7-42-3',
          delay: 5000,
          attempts: 6,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
        },
      },
    ]);
  });

  it('write-off and disconnect: own fixed ids, no delay', async () => {
    const { queue, enqueue } = setup();
    await enqueue(WRITE_OFF);
    await enqueue(DISCONNECT);
    expect(
      queue.added.map((a) => [a.name, a.opts.jobId, a.opts.delay]),
    ).toEqual([
      ['write-off', 'cal-writeoff-7', 0],
      ['disconnect', 'cal-disconnect-7', 0],
    ]);
  });

  it('job ids never contain ":" (BullMQ 6 rejects them)', async () => {
    const { queue, enqueue } = setup();
    queue.seed('cal-write-7-42-3', 'active');
    for (const d of [RECONCILE, WRITE_OFF, DISCONNECT]) await enqueue(d);
    const ids = queue.added.map((a) => a.opts.jobId as string);
    expect(ids.filter((id) => id.includes(':'))).toEqual([]);
  });
});

describe('enqueueCalendarWriteJob — existing job with the same id', () => {
  it.each(['waiting', 'delayed'])(
    'a %s duplicate collapses (no add)',
    async (state) => {
      const { queue, enqueue } = setup();
      queue.seed('cal-write-7-42-3', state);
      await expect(enqueue(RECONCILE)).resolves.toEqual({
        outcome: 'collapsed',
        jobId: 'cal-write-7-42-3',
      });
      expect(queue.added).toEqual([]);
      expect(queue.removed).toEqual([]);
    },
  );

  it.each(['completed', 'failed'])(
    'a retained %s job is cleared, then the job is added',
    async (state) => {
      const { queue, enqueue } = setup();
      queue.seed('cal-write-7-42-3', state);
      await expect(enqueue(RECONCILE)).resolves.toEqual({
        outcome: 'added',
        jobId: 'cal-write-7-42-3',
      });
      expect(queue.removed).toEqual(['cal-write-7-42-3']);
      expect(queue.jobs.get('cal-write-7-42-3')?.state).toBe('delayed');
    },
  );

  it('an ACTIVE job gets exactly one -rerun follow-up', async () => {
    const { queue, enqueue } = setup();
    queue.seed('cal-write-7-42-3', 'active');
    await expect(enqueue(RECONCILE)).resolves.toEqual({
      outcome: 'rerun',
      jobId: 'cal-write-7-42-3-rerun',
    });
    await expect(enqueue(RECONCILE)).resolves.toEqual({
      outcome: 'collapsed',
      jobId: 'cal-write-7-42-3-rerun',
    });
    expect(queue.added.map((a) => [a.opts.jobId, a.opts.delay])).toEqual([
      ['cal-write-7-42-3-rerun', 5000],
    ]);
  });

  it('a retained finished -rerun job is cleared before the new follow-up', async () => {
    const { queue, enqueue } = setup();
    queue.seed('cal-write-7-42-3', 'active');
    queue.seed('cal-write-7-42-3-rerun', 'completed');
    await expect(enqueue(RECONCILE)).resolves.toEqual({
      outcome: 'rerun',
      jobId: 'cal-write-7-42-3-rerun',
    });
    expect(queue.removed).toEqual(['cal-write-7-42-3-rerun']);
    expect(queue.jobs.get('cal-write-7-42-3-rerun')?.state).toBe('delayed');
  });
});

describe('enqueueCalendarWriteJob — kill switch', () => {
  it('off: reconcile is dropped without touching the queue', async () => {
    const { queue, enqueue, isSyncEnabled } = setup(false);
    await expect(enqueue(RECONCILE)).resolves.toEqual({
      outcome: 'dropped',
      jobId: null,
    });
    expect(isSyncEnabled).toHaveBeenCalledTimes(1);
    expect(queue.added).toEqual([]);
  });

  it('off: cleanup kinds (write-off, disconnect) still enqueue', async () => {
    const { queue, enqueue, isSyncEnabled } = setup(false);
    expect((await enqueue(WRITE_OFF)).outcome).toBe('added');
    expect((await enqueue(DISCONNECT)).outcome).toBe('added');
    expect(queue.added.map((a) => a.opts.jobId)).toEqual([
      'cal-writeoff-7',
      'cal-disconnect-7',
    ]);
    expect(isSyncEnabled).not.toHaveBeenCalled();
  });
});
