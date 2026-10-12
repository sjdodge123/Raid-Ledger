/**
 * ROK-1593 — shared fixtures for the calendar read integration specs
 * (`calendar-away-sync.integration.spec.ts`; the A9 pipeline spec still keeps
 * its own copies). Pure helpers: no app, no DB.
 */
import type {
  BusyBlock,
  ConnectResult,
  OAuthCredentials,
} from '../providers/calendar-provider.interface';
import type { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import { FAKE_PRIMARY_CALENDAR_ID } from '../providers/testing/fake-calendar-store';

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
/** An `rl:` copy-id instance that is NOT this deployment. */
export const FOREIGN_INSTANCE = 'abcdefabcdef';

/** Empty the shared Fake: copies, calendars, seeded busy, recorded calls. */
export function resetFake(fake: FakeCalendarProvider): void {
  for (const c of fake.store.allCopies()) fake.store.deleteCopy(c.id);
  for (const cal of fake.store.listCalendars())
    fake.store.removeCalendar(cal.id);
  fake.seedCalendars([{ id: FAKE_PRIMARY_CALENDAR_ID, name: 'Primary' }]);
  fake.fetchBusyCalls.length = 0;
  fake.store.clearFailures();
  for (;;) {
    try {
      fake.store.takeReadFailure();
      return;
    } catch {
      // drop a queued read failure left by a failed test
    }
  }
}

/** The Fake ignores credentials on copy writes; any OAuth shape will do. */
export function credsOf(result: ConnectResult): OAuthCredentials {
  const grant = result.credentials;
  return { ...grant, refreshToken: grant.refreshToken ?? 'fake-refresh' };
}

/** Tomorrow (UTC) at `hour:minute` — always inside the read window. */
export function tomorrowAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + DAY + hour * HOUR + minute * 60 * 1000);
}

export function timed(start: Date, end: Date): BusyBlock {
  return { start, end, allDay: false };
}

/** An all-day block over the inclusive dates, as the adapters emit one. */
export function allDay(first: string, lastInclusive: string): BusyBlock {
  const start = new Date(`${first}T00:00:00.000Z`);
  const last = new Date(`${lastInclusive}T00:00:00.000Z`);
  return {
    start,
    end: new Date(last.getTime() + DAY),
    allDay: true,
    allDayDates: { first, lastInclusive },
  };
}
