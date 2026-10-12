/**
 * ROK-1593 §3.4 / D5: what the read worker does with a failed sync — the
 * connection write (via the real `recordReadSyncFailure`) and whether BullMQ
 * may retry. The runner is mocked to throw.
 */
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import type { QueueHealthService } from '../../queue/queue-health.service';
import type { SettingsService } from '../../settings/settings.service';
import type { GameTimeService } from '../../users/game-time.service';
import {
  ProviderAuthError,
  TransientError,
} from '../providers/calendar-provider.errors';
import type { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import type { CalendarReadJobData } from './calendar-read.enqueue.helpers';
import { CalendarReadProcessor } from './calendar-read.processor';
import { runCalendarReadSync } from './calendar-read-sync.helpers';

jest.mock('./calendar-read-sync.helpers', () => ({
  runCalendarReadSync: jest.fn(),
}));
const runSync = jest.mocked(runCalendarReadSync);

const CONN = {
  id: 5,
  userId: 3,
  status: 'active',
  provider: 'google',
  accountSubject: 'sub',
  lastSyncedAt: new Date('2026-10-11T11:00:00Z'),
  createdAt: new Date('2026-10-01T00:00:00Z'),
};

function setup(enabled = true) {
  const sets: Record<string, unknown>[] = [];
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([CONN]),
  };
  const db = {
    select: () => chain,
    update: () => ({
      set: (v: Record<string, unknown>) => {
        sets.push(v);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  const settings = {
    get: () => Promise.resolve(String(enabled)),
    getClientUrl: () => Promise.resolve('https://raid.example.com'),
    getDefaultTimezone: () => Promise.resolve('UTC'),
  };
  const registry = { getReadProviderForConnection: () => Promise.resolve({}) };
  const invalidate = jest.fn();
  const processor = new CalendarReadProcessor(
    db as never,
    registry as unknown as CalendarProviderRegistry,
    settings as unknown as SettingsService,
    { invalidateUserCache: invalidate } as unknown as GameTimeService,
    {} as Queue,
    {} as QueueHealthService,
  );
  return { processor, sets, invalidate };
}

function job(attemptsMade: number): Job<CalendarReadJobData> {
  return {
    data: { kind: 'sync', connectionId: CONN.id },
    attemptsMade,
    opts: { attempts: 4 },
  } as unknown as Job<CalendarReadJobData>;
}

describe('CalendarReadProcessor failures', () => {
  beforeEach(() => runSync.mockReset());

  it('auth error → needs_reconnect + UnrecoverableError (no retry)', async () => {
    const { processor, sets } = setup();
    runSync.mockRejectedValue(new ProviderAuthError());
    await expect(processor.process(job(0))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(sets).toEqual([
      expect.objectContaining({
        status: 'needs_reconnect',
        lastErrorCode: 'auth',
      }),
    ]);
  });

  it('403 scope → read_access_granted=false, read off, no retry', async () => {
    const { processor, sets } = setup();
    runSync.mockRejectedValue(new ProviderAuthError('scope'));
    await expect(processor.process(job(0))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(sets).toEqual([
      expect.objectContaining({
        readAccessGranted: false,
        readEnabled: false,
        lastErrorCode: 'read_scopes',
      }),
    ]);
    expect(sets[0]).not.toHaveProperty('status');
  });

  it('transient, attempts left → rethrown for backoff, nothing written', async () => {
    const { processor, sets } = setup();
    const err = new TransientError();
    runSync.mockRejectedValue(err);
    await expect(processor.process(job(1))).rejects.toBe(err);
    expect(sets).toEqual([]);
  });

  it('transient on the final attempt → code + 1 h backoff, status untouched', async () => {
    const { processor, sets, invalidate } = setup();
    runSync.mockRejectedValue(new TransientError());
    const before = Date.now();
    await expect(processor.process(job(3))).rejects.toBeInstanceOf(
      TransientError,
    );
    expect(sets).toEqual([
      expect.objectContaining({ lastErrorCode: 'provider_error' }),
    ]);
    // Status is shared with the ROK-1596 write side (active-only selects).
    expect(sets[0]).not.toHaveProperty('status');
    const at = sets[0]?.nextSyncAt;
    if (!(at instanceof Date)) throw new Error('nextSyncAt not written');
    const next = at.getTime();
    expect(next - before).toBeGreaterThanOrEqual(60 * 60_000);
    expect(next - before).toBeLessThan(60 * 60_000 + 5_000);
    expect(invalidate).toHaveBeenCalledWith(CONN.userId);
  });

  it('kill switch off → skipped before any load or provider call', async () => {
    const { processor, sets } = setup(false);
    await expect(processor.process(job(0))).resolves.toBe('skipped');
    expect(runSync).not.toHaveBeenCalled();
    expect(sets).toEqual([]);
  });
});
