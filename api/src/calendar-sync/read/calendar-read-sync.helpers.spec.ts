/**
 * ROK-1593 A5 — the read runner's pure decisions: R1 calendar selection,
 * missing-calendar prune, next-sync jitter, D5 error classification and the
 * error backoff. The transaction itself is proven by A9's integration spec.
 */
import {
  NotFoundError,
  ProviderAuthError,
  RateLimitError,
  ProviderRequestError,
  TransientError,
} from '../providers/calendar-provider.errors';
import type { ProviderCalendar } from '../providers/calendar-provider.interface';
import {
  classifyReadFailure,
  readErrorBackoffMs,
} from './calendar-read-failure.helpers';
import {
  buildSyncedFields,
  nextReadSyncAt,
  pruneReadCalendarIds,
  safeReadWindow,
  selectReadCalendarIds,
} from './calendar-read-sync.helpers';

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const NOW = new Date('2026-10-20T12:00:00Z');

function cal(id: string, isRaidLedger = false): ProviderCalendar {
  return { id, name: id, primary: false, writable: true, isRaidLedger };
}

describe('selectReadCalendarIds (R1)', () => {
  it('reads primary when no calendars are chosen', () => {
    const conn = { readCalendarIds: [], dedicatedCalendarId: null };
    expect(selectReadCalendarIds(conn, [])).toEqual(['primary']);
  });

  it('never reads the dedicated calendar, even when wrongly chosen', () => {
    const conn = {
      readCalendarIds: ['work', 'rl-cal', 'work'],
      dedicatedCalendarId: 'rl-cal',
    };
    expect(selectReadCalendarIds(conn, [])).toEqual(['work']);
  });

  it('never reads a calendar the provider flags as Raid Ledger', () => {
    const conn = {
      readCalendarIds: ['home', 'rl-x'],
      dedicatedCalendarId: null,
    };
    const listed = [cal('home'), cal('rl-x', true)];
    expect(selectReadCalendarIds(conn, listed)).toEqual(['home']);
  });
});

describe('pruneReadCalendarIds', () => {
  it('drops only the calendars the provider reported missing', () => {
    expect(pruneReadCalendarIds(['a', 'b', 'c'], ['b', 'zz'])).toEqual([
      'a',
      'c',
    ]);
  });
});

describe('nextReadSyncAt (D7 jitter)', () => {
  it('lands 30 min out ± 5 min', () => {
    const at = (r: number) => nextReadSyncAt(NOW, () => r).getTime() - +NOW;
    expect(at(0)).toBe(25 * MIN);
    expect(at(0.5)).toBe(30 * MIN);
    expect(at(1)).toBe(35 * MIN);
  });
});

describe('safeReadWindow', () => {
  it('falls back to UTC for an unknown zone', () => {
    const w = safeReadWindow(NOW, 'Not/AZone');
    expect(w.start.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(w.timeZone).toBe('UTC');
  });
});

describe('classifyReadFailure (D5)', () => {
  it('maps a scope 403 to read_scopes without retry', () => {
    expect(classifyReadFailure(new ProviderAuthError('scope'))).toEqual({
      code: 'read_scopes',
      retry: false,
    });
  });

  it('maps other auth failures to auth without retry', () => {
    expect(classifyReadFailure(new ProviderAuthError('http_401'))).toEqual({
      code: 'auth',
      retry: false,
    });
  });

  it('retries a rate limit no sooner than Retry-After', () => {
    expect(classifyReadFailure(new RateLimitError(90_000))).toEqual({
      code: 'rate_limited',
      retry: true,
      retryAfterMs: 90_000,
    });
  });

  it('retries transient and unknown failures as provider_error', () => {
    for (const err of [
      new TransientError(),
      new NotFoundError(),
      new Error('x'),
    ]) {
      expect(classifyReadFailure(err)).toEqual({
        code: 'provider_error',
        retry: true,
      });
    }
  });

  it('does not retry a permanent refusal', () => {
    expect(classifyReadFailure(new ProviderRequestError())).toEqual({
      code: 'provider_error',
      retry: false,
    });
  });
});

describe('readErrorBackoffMs (1 h doubling, cap 6 h)', () => {
  const created = new Date('2026-10-01T00:00:00Z');
  const since = (h: number) => new Date(NOW.getTime() - h * HOUR);

  it('starts at 1 h when no transient read failure is recorded yet', () => {
    const conn = {
      lastErrorCode: null,
      lastSyncedAt: since(30),
      createdAt: created,
    };
    expect(readErrorBackoffMs(conn, NOW)).toBe(HOUR);
  });

  it('doubles with the time already spent failing, capped at 6 h', () => {
    const at = (h: number) =>
      readErrorBackoffMs(
        {
          lastErrorCode: 'provider_error',
          lastSyncedAt: since(h),
          createdAt: created,
        },
        NOW,
      );
    expect([at(0.5), at(1.5), at(3.5), at(7.5), at(40)]).toEqual([
      HOUR,
      2 * HOUR,
      4 * HOUR,
      6 * HOUR,
      6 * HOUR,
    ]);
  });
});

describe('buildSyncedFields (the success UPDATE)', () => {
  const stamp = { now: NOW, random: () => 0.5 };
  const locked = { readCalendarIds: ['a', 'gone', 'policy'] };

  it('never writes status (shared with the write side)', () => {
    const fields = buildSyncedFields(locked, {}, stamp);
    expect(Object.keys(fields).sort()).toEqual([
      'lastErrorCode',
      'lastSyncedAt',
      'nextSyncAt',
      'updatedAt',
    ]);
    expect(fields.lastErrorCode).toBeNull();
  });

  it('a policy-refused calendar records provider_error and is not pruned', () => {
    const fields = buildSyncedFields(
      locked,
      { missingCalendarIds: ['gone'], unreadableCalendarIds: ['policy'] },
      stamp,
    );
    expect(fields).not.toHaveProperty('status');
    expect(fields.lastErrorCode).toBe('provider_error');
    expect(fields.readCalendarIds).toEqual(['a', 'policy']);
    expect(fields.lastSyncedAt).toBe(NOW);
  });
});
