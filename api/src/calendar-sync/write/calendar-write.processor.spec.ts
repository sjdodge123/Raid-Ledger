/**
 * ROK-1593 — a `failed` write job checks whether the
 * connection went `needs_reconnect` and, if so, queues a read derive. The
 * job bodies and the check itself are mocked (the check is unit-tested in
 * `calendar-away-heal.helpers.spec.ts`).
 */
import { WORKER_METADATA } from '@nestjs/bullmq/dist/bull.constants';
import { DelayedError, type Job, type Queue } from 'bullmq';
import type { QueueHealthService } from '../../queue/queue-health.service';
import type { SettingsService } from '../../settings/settings.service';
import { deriveIfNeedsReconnect } from '../read/calendar-away-heal.helpers';
import type { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import type { CalendarWriteJobData } from './calendar-write.enqueue.helpers';
import { CalendarWriteProcessor } from './calendar-write.processor';
import { calendarRetryBackoff } from '../calendar-retry-backoff.helpers';
import { reconcileCalendarCopy } from './calendar-write-reconcile.helpers';
import { runCalendarWriteOff } from './calendar-write-off.helpers';
import { WRITE_DEBOUNCE_MS } from '../calendar-sync.constants';

jest.mock('../read/calendar-away-heal.helpers', () => ({
  deriveIfNeedsReconnect: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./calendar-write-reconcile.helpers', () => ({
  reconcileCalendarCopy: jest.fn(),
}));
jest.mock('./calendar-write-off.helpers', () => ({
  runCalendarWriteOff: jest.fn(),
}));
const check = jest.mocked(deriveIfNeedsReconnect);
const reconcile = jest.mocked(reconcileCalendarCopy);
const writeOff = jest.mocked(runCalendarWriteOff);

const DB = { db: true };
const READ_QUEUE = { read: true };

/** Write-queue fake: `states` maps a job id to its BullMQ state. */
function makeQueue(states: Record<string, string> = {}) {
  return {
    getJobState: jest.fn((id: string) =>
      Promise.resolve(states[id] ?? 'unknown'),
    ),
  };
}

function makeProcessor(queue = makeQueue()) {
  return new CalendarWriteProcessor(
    DB as never,
    {} as CalendarProviderRegistry,
    {} as SettingsService,
    queue as unknown as Queue,
    {} as QueueHealthService,
    READ_QUEUE as unknown as Queue,
  );
}

const job = (data: CalendarWriteJobData) =>
  ({
    data,
    attemptsMade: 0,
    opts: { attempts: 6 },
  }) as Job<CalendarWriteJobData>;

describe('CalendarWriteProcessor → derive on needs_reconnect', () => {
  beforeEach(() => jest.clearAllMocks());

  it('failed write-off → checks the connection for needs_reconnect', async () => {
    writeOff.mockResolvedValue({ result: 'failed', reason: 'auth' });
    await makeProcessor().process(job({ kind: 'write-off', connectionId: 8 }));
    expect(check).toHaveBeenCalledWith(DB, READ_QUEUE, 8);
  });

  it('failed reconcile → checks the connection; the outcome is unchanged', async () => {
    reconcile.mockResolvedValue({ result: 'failed', reason: 'auth' });
    const data = { kind: 'reconcile', connectionId: 8, eventId: 2, userId: 4 };
    await expect(
      makeProcessor().process(job(data as CalendarWriteJobData)),
    ).resolves.toEqual({ result: 'failed', reason: 'auth' });
    expect(check).toHaveBeenCalledWith(DB, READ_QUEUE, 8);
  });

  it('successful reconcile → no check', async () => {
    reconcile.mockResolvedValue({ result: 'created' });
    const data = { kind: 'reconcile', connectionId: 8, eventId: 2, userId: 4 };
    await makeProcessor().process(job(data as CalendarWriteJobData));
    expect(check).not.toHaveBeenCalled();
  });
});

const RECONCILE: CalendarWriteJobData = {
  kind: 'reconcile',
  connectionId: 8,
  eventId: 2,
  userId: 4,
};
const PLAIN_ID = 'cal-write-8-2-4';
const RERUN_ID = `${PLAIN_ID}-rerun`;

/** An active job as the worker hands it to `process` (id + moveToDelayed). */
function activeJob(id: string) {
  const moveToDelayed = jest.fn().mockResolvedValue(undefined);
  const j = { ...job(RECONCILE), id, moveToDelayed };
  return { job: j as unknown as Job<CalendarWriteJobData>, moveToDelayed };
}

describe('CalendarWriteProcessor → a key never runs twice at once', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reconcile.mockResolvedValue({ result: 'created' });
  });

  it('a -rerun whose plain job is still active waits instead of creating a second copy', async () => {
    const queue = makeQueue({ [PLAIN_ID]: 'active' });
    const { job: rerun, moveToDelayed } = activeJob(RERUN_ID);
    const before = Date.now();
    await expect(
      makeProcessor(queue).process(rerun, 'tok'),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(reconcile).not.toHaveBeenCalled();
    expect(queue.getJobState).toHaveBeenCalledWith(PLAIN_ID);
    const [until, token] = moveToDelayed.mock.calls[0] ?? [];
    expect(token).toBe('tok');
    expect(until).toBeGreaterThanOrEqual(before + WRITE_DEBOUNCE_MS);
  });

  it('a plain job (e.g. a retry) whose -rerun is active waits too', async () => {
    const queue = makeQueue({ [RERUN_ID]: 'active' });
    const { job: plain, moveToDelayed } = activeJob(PLAIN_ID);
    await expect(
      makeProcessor(queue).process(plain, 'tok'),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(reconcile).not.toHaveBeenCalled();
    expect(queue.getJobState).toHaveBeenCalledWith(RERUN_ID);
    expect(moveToDelayed).toHaveBeenCalledTimes(1);
  });

  it('runs normally when its sibling is pending or gone', async () => {
    const queue = makeQueue({ [PLAIN_ID]: 'delayed' });
    const { job: rerun, moveToDelayed } = activeJob(RERUN_ID);
    await expect(makeProcessor(queue).process(rerun, 'tok')).resolves.toEqual({
      result: 'created',
    });
    expect(moveToDelayed).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});

/** The `@Processor` worker options `@nestjs/bullmq` stores. */
type WorkerMeta = { settings?: { backoffStrategy?: unknown } } | undefined;

describe('CalendarWriteProcessor worker registration', () => {
  it('registers the Retry-After-aware backoff strategy on the worker', () => {
    // Without it BullMQ throws "Unknown backoff strategy" on the first retry.
    const opts = Reflect.getMetadata(
      WORKER_METADATA,
      CalendarWriteProcessor,
    ) as WorkerMeta;
    expect(opts?.settings?.backoffStrategy).toBe(calendarRetryBackoff);
  });
});
