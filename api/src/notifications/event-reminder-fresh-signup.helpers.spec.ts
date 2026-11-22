/** ROK-2293: fresh-signup rule for the reminder cron. */
import { REMINDER_FRESH_SIGNUP_GRACE_MS } from './event-reminder.constants';
import {
  collectFreshSignups,
  freshSignupKey,
  isFreshSignup,
} from './event-reminder-fresh-signup.helpers';

const now = new Date('2026-11-21T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('isFreshSignup', () => {
  it('is fresh just inside the 15-minute grace', () => {
    expect(REMINDER_FRESH_SIGNUP_GRACE_MS).toBe(15 * 60 * 1000);
    expect(isFreshSignup(ago(REMINDER_FRESH_SIGNUP_GRACE_MS - 1000), now)).toBe(
      true,
    );
  });

  it('is not fresh at or past 15 minutes', () => {
    expect(isFreshSignup(ago(REMINDER_FRESH_SIGNUP_GRACE_MS), now)).toBe(false);
    expect(isFreshSignup(ago(60 * 60 * 1000), now)).toBe(false);
  });
});

describe('collectFreshSignups', () => {
  it('keys only fresh rows that have a user', () => {
    const fresh = collectFreshSignups(
      [
        { eventId: 1, userId: 10, activatedAt: ago(60_000) },
        { eventId: 1, userId: 11, activatedAt: ago(20 * 60_000) },
        { eventId: 2, userId: null, activatedAt: ago(60_000) },
      ],
      now,
    );
    expect([...fresh]).toEqual([freshSignupKey(1, 10)]);
  });
});
