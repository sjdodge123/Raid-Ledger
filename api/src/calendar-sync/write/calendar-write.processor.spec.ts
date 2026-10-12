/**
 * ROK-1593 PR-B review MAJOR-2 (b): a `failed` write job checks whether the
 * connection went `needs_reconnect` and, if so, queues a read derive. The
 * job bodies and the check itself are mocked (the check is unit-tested in
 * `calendar-away-heal.helpers.spec.ts`).
 */
import type { Job, Queue } from 'bullmq';
import type { QueueHealthService } from '../../queue/queue-health.service';
import type { SettingsService } from '../../settings/settings.service';
import { deriveIfNeedsReconnect } from '../read/calendar-away-heal.helpers';
import type { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import type { CalendarWriteJobData } from './calendar-write.enqueue.helpers';
import { CalendarWriteProcessor } from './calendar-write.processor';
import { reconcileCalendarCopy } from './calendar-write-reconcile.helpers';
import { runCalendarWriteOff } from './calendar-write-off.helpers';

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

function makeProcessor() {
  return new CalendarWriteProcessor(
    DB as never,
    {} as CalendarProviderRegistry,
    {} as SettingsService,
    {} as Queue,
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
