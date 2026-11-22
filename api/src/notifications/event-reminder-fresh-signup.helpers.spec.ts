/** ROK-2293: fresh-signup rule for the reminder cron. */
import { PgDialect } from 'drizzle-orm/pg-core';
import { REMINDER_FRESH_SIGNUP_GRACE_MS } from './event-reminder.constants';
import {
  activeSignupFreshSince,
  freshSignupCutoff,
} from './event-reminder-fresh-signup.helpers';

const now = new Date('2026-11-21T12:00:00Z');

describe('freshSignupCutoff', () => {
  it('is the 15-minute grace before the pass clock', () => {
    expect(REMINDER_FRESH_SIGNUP_GRACE_MS).toBe(15 * 60 * 1000);
    expect(freshSignupCutoff(now).toISOString()).toBe(
      '2026-11-21T11:45:00.000Z',
    );
  });
});

describe('activeSignupFreshSince', () => {
  const query = new PgDialect().sqlToQuery(
    activeSignupFreshSince({ eventId: 7, userId: 42 }, freshSignupCutoff(now)),
  );

  it("checks this user's active signup for this event", () => {
    expect(query.sql).toMatch(/"event_signups"\."event_id" = \$\d/);
    expect(query.sql).toMatch(/"event_signups"\."user_id" = \$\d/);
    expect(query.sql).toMatch(/"event_signups"\."status" in \(\$\d, \$\d\)/);
    expect(query.params.slice(0, 4)).toEqual([7, 42, 'signed_up', 'tentative']);
  });

  it('is fresh only when activated_at is after the cutoff, as UTC wall time', () => {
    expect(query.sql).toMatch(
      /"event_signups"\."activated_at" > \(\$\d::timestamptz AT TIME ZONE 'UTC'\)/,
    );
    expect(query.params[4]).toBe('2026-11-21T11:45:00.000Z');
  });
});
