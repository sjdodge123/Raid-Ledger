/**
 * ROK-1593 F3: the manual-sync throttle. A partial success (one calendar
 * refused) leaves `provider_error` but must not hold the user to the
 * failure backoff; a true failure still does.
 */
import { isManualSyncThrottled } from './calendar-read-settings.helpers';

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
