/**
 * ROK-1593 D-R5: the read queue's fixed-id rules, against an in-memory queue
 * that — like BullMQ — ignores an `add` whose id exists in any state.
 */
import { CALENDAR_READ_QUEUE, readSyncJobId } from '../calendar-sync.constants';
import {
  CALENDAR_READ_JOB_OPTIONS,
  enqueueCalendarDerive,
  enqueueCalendarReadSync,
  type CalendarReadQueue,
} from './calendar-read.enqueue.helpers';

class FakeReadQueue {
  readonly jobs = new Map<string, string>();
  readonly added: Array<{ name: string; data: unknown; jobId: string }> = [];

  seed(jobId: string, state: string): void {
    this.jobs.set(jobId, state);
  }

  getJob(jobId: string) {
    const state = this.jobs.get(jobId);
    return Promise.resolve(
      state ? { getState: () => Promise.resolve(state) } : undefined,
    );
  }

  add(name: string, data: unknown, opts: { jobId: string }) {
    this.added.push({ name, data, jobId: opts.jobId });
    if (!this.jobs.has(opts.jobId)) this.jobs.set(opts.jobId, 'waiting');
    return Promise.resolve({ id: opts.jobId });
  }

  remove(jobId: string) {
    return Promise.resolve(this.jobs.delete(jobId) ? 1 : 0);
  }
}

const CONN = 9;
const ID = 'cal-read-9';

function setup(enabled = true) {
  const queue = new FakeReadQueue();
  const deps = {
    queue: queue as unknown as CalendarReadQueue,
    isSyncEnabled: () => Promise.resolve(enabled),
  };
  return { queue, enqueue: () => enqueueCalendarReadSync(deps, CONN) };
}

describe('enqueueCalendarReadSync', () => {
  it('names the queue and the hyphenated fixed id', () => {
    expect(CALENDAR_READ_QUEUE).toBe('calendar-read');
    expect(readSyncJobId(CONN)).toBe(ID);
  });

  it('adds a sync with the D-R5 retry policy and an ids-only payload', async () => {
    const { queue, enqueue } = setup();
    await expect(enqueue()).resolves.toEqual({ outcome: 'added', jobId: ID });
    expect(queue.added).toEqual([
      { name: 'sync', data: { kind: 'sync', connectionId: CONN }, jobId: ID },
    ]);
    expect(CALENDAR_READ_JOB_OPTIONS).toMatchObject({
      attempts: 4,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: true,
    });
    expect(typeof CALENDAR_READ_JOB_OPTIONS.removeOnFail).toBe('number');
  });

  it.each(['completed', 'failed'])(
    'ROK-1762: a retained %s job with the same id does not swallow the re-add',
    async (state) => {
      const { queue, enqueue } = setup();
      queue.seed(ID, state);
      await expect(enqueue()).resolves.toEqual({ outcome: 'added', jobId: ID });
      expect(queue.added.map((a) => a.jobId)).toEqual([ID]);
      expect(queue.jobs.get(ID)).toBe('waiting');
    },
  );

  it.each(['waiting', 'delayed'])('a %s duplicate collapses', async (state) => {
    const { queue, enqueue } = setup();
    queue.seed(ID, state);
    await expect(enqueue()).resolves.toEqual({
      outcome: 'collapsed',
      jobId: ID,
    });
    expect(queue.added).toEqual([]);
  });

  it('an ACTIVE job gets exactly one -rerun', async () => {
    const { queue, enqueue } = setup();
    queue.seed(ID, 'active');
    await expect(enqueue()).resolves.toEqual({
      outcome: 'rerun',
      jobId: `${ID}-rerun`,
    });
    await expect(enqueue()).resolves.toEqual({
      outcome: 'collapsed',
      jobId: `${ID}-rerun`,
    });
    expect(queue.added.map((a) => a.jobId)).toEqual([`${ID}-rerun`]);
  });

  it('a live -rerun absorbs a trigger after the plain job finished', async () => {
    const { queue, enqueue } = setup();
    queue.seed(ID, 'completed');
    queue.seed(`${ID}-rerun`, 'waiting');
    await expect(enqueue()).resolves.toEqual({
      outcome: 'collapsed',
      jobId: `${ID}-rerun`,
    });
    expect(queue.added).toEqual([]);
  });

  it('kill switch off → dropped, nothing touched', async () => {
    const { queue, enqueue } = setup(false);
    queue.seed(ID, 'completed');
    await expect(enqueue()).resolves.toEqual({
      outcome: 'dropped',
      jobId: null,
    });
    expect(queue.added).toEqual([]);
    expect(queue.jobs.get(ID)).toBe('completed');
  });
});

describe('enqueueCalendarDerive (ROK-1593 PR-B)', () => {
  const USER = 4;
  const DERIVE_ID = 'cal-derive-4';

  function setupDerive() {
    const queue = new FakeReadQueue();
    const enqueue = () =>
      enqueueCalendarDerive(queue as unknown as CalendarReadQueue, USER);
    return { queue, enqueue };
  }

  it('adds a per-user derive with an ids-only payload', async () => {
    const { queue, enqueue } = setupDerive();
    await expect(enqueue()).resolves.toEqual({
      outcome: 'added',
      jobId: DERIVE_ID,
    });
    expect(queue.added).toEqual([
      {
        name: 'derive',
        data: { kind: 'derive', userId: USER },
        jobId: DERIVE_ID,
      },
    ]);
  });

  it('a pending derive collapses; a retained completed one is re-added', async () => {
    const { queue, enqueue } = setupDerive();
    queue.seed(DERIVE_ID, 'waiting');
    await expect(enqueue()).resolves.toEqual({
      outcome: 'collapsed',
      jobId: DERIVE_ID,
    });
    queue.seed(DERIVE_ID, 'completed');
    await expect(enqueue()).resolves.toEqual({
      outcome: 'added',
      jobId: DERIVE_ID,
    });
    expect(queue.added.map((a) => a.jobId)).toEqual([DERIVE_ID]);
  });

  it('an ACTIVE derive gets exactly one -rerun', async () => {
    const { queue, enqueue } = setupDerive();
    queue.seed(DERIVE_ID, 'active');
    await expect(enqueue()).resolves.toEqual({
      outcome: 'rerun',
      jobId: `${DERIVE_ID}-rerun`,
    });
  });
});
