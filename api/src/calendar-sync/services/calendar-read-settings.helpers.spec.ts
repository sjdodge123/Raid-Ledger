/**
 * ROK-1593 F3: the manual-sync throttle. A partial success (one calendar
 * refused) leaves `provider_error` but must not hold the user to the
 * failure backoff; a true failure still does.
 */
import {
  applyReadUpdate,
  isManualSyncThrottled,
  type CalendarReadSettingsDeps,
  type ReadUpdatePlan,
} from './calendar-read-settings.helpers';

const MIN = 60_000;
const NOW = Date.parse('2026-10-12T12:00:00Z');
const at = (mins: number): Date => new Date(NOW + mins * MIN);

type ThrottleRow = Parameters<typeof isManualSyncThrottled>[0];
const row = (patch: Partial<ThrottleRow>): ThrottleRow => ({
  status: 'active',
  lastErrorCode: null,
  nextSyncAt: null,
  lastSyncedAt: null,
  ...patch,
});

describe('isManualSyncThrottled', () => {
  it('partial success 6 min ago (provider_error, cadence next_sync_at) → not throttled', () => {
    const partial = row({
      lastErrorCode: 'provider_error',
      lastSyncedAt: at(-6),
      nextSyncAt: at(-6 + 30),
    });
    expect(isManualSyncThrottled(partial, NOW)).toBe(false);
  });

  it('partial success 2 min ago → throttled by the 5-min rule only', () => {
    const partial = row({
      lastErrorCode: 'provider_error',
      lastSyncedAt: at(-2),
      nextSyncAt: at(-2 + 34),
    });
    expect(isManualSyncThrottled(partial, NOW)).toBe(true);
  });

  it('partial success at the cadence edge (next = last + 35 min) → not throttled', () => {
    const partial = row({
      lastErrorCode: 'provider_error',
      lastSyncedAt: at(-6),
      nextSyncAt: at(-6 + 35),
    });
    expect(isManualSyncThrottled(partial, NOW)).toBe(false);
  });

  it('just past the cadence edge (next = last + 36 min) reads as a backoff → throttled', () => {
    const failed = row({
      lastErrorCode: 'provider_error',
      lastSyncedAt: at(-6),
      nextSyncAt: at(-6 + 36),
    });
    expect(isManualSyncThrottled(failed, NOW)).toBe(true);
  });

  it('true failure after an older success, inside its backoff → throttled', () => {
    const failed = row({
      lastErrorCode: 'provider_error',
      lastSyncedAt: at(-40),
      nextSyncAt: at(20),
    });
    expect(isManualSyncThrottled(failed, NOW)).toBe(true);
  });

  it('true failure with no success ever, inside its backoff → throttled', () => {
    const failed = row({ lastErrorCode: 'rate_limited', nextSyncAt: at(50) });
    expect(isManualSyncThrottled(failed, NOW)).toBe(true);
  });

  it('true failure whose backoff has passed → may sync', () => {
    const failed = row({
      lastErrorCode: 'provider_error',
      lastSyncedAt: at(-120),
      nextSyncAt: at(-1),
    });
    expect(isManualSyncThrottled(failed, NOW)).toBe(false);
  });
});

describe('applyReadUpdate — queued jobs', () => {
  function setup() {
    const added: string[] = [];
    const queue = {
      getJob: () => Promise.resolve(undefined),
      remove: () => Promise.resolve(0),
      add: (_n: string, _d: unknown, o: { jobId: string }) => {
        added.push(o.jobId);
        return Promise.resolve({});
      },
    };
    const db = {
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };
    const deps = {
      db,
      readQueue: { queue, isSyncEnabled: () => Promise.resolve(true) },
      invalidateUser: () => undefined,
    } as unknown as CalendarReadSettingsDeps;
    return { deps, added };
  }
  const plan = (was: boolean, now: boolean) =>
    ({
      row: { id: 3, userId: 7, readEnabled: was },
      readEnabled: now,
      readCalendarIds: [],
    }) as unknown as ReadUpdatePlan;

  it('read turned off → a derive for the owner, no sync', async () => {
    const { deps, added } = setup();
    await applyReadUpdate(deps, plan(true, false));
    expect(added).toEqual(['cal-derive-7']);
  });

  it('read left on → a sync only', async () => {
    const { deps, added } = setup();
    await applyReadUpdate(deps, plan(true, true));
    expect(added).toEqual(['cal-read-3']);
  });

  it('read already off and staying off → nothing queued', async () => {
    const { deps, added } = setup();
    await applyReadUpdate(deps, plan(false, false));
    expect(added).toEqual([]);
  });
});
