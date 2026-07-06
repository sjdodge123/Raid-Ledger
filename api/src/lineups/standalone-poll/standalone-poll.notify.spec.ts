/**
 * Unit tests for notifyPollVoters per-recipient timezone rendering (ROK-1112).
 *
 * Previously the chosen timeslot was formatted ONCE and the same string was
 * DMed to every recipient, so an EDT voter and a PDT voter both saw the
 * server-TZ (UTC) render. The fix moves formatting into the per-recipient loop
 * and resolves each recipient's IANA timezone (preference → guild default →
 * 'UTC'). This test proves two recipients with different prefs receive
 * different message strings for the same source ISO.
 *
 * ROK-1392: the helper was extracted from StandalonePollService.notifyVoters to
 * `standalone-poll-voter.helpers.ts` to keep the service module under the
 * 300-line limit — these tests now exercise the exported function directly.
 */
import {
  notifyPollVoters,
  type NotifyPollVotersDeps,
} from './standalone-poll-voter.helpers';

interface NotifyMock {
  notifyAutoSignup: jest.Mock;
  notifyPollOutcome: jest.Mock;
}

/**
 * Build a DB mock whose `select().from().where()` chain resolves the BATCHED
 * `user_preferences.timezone` lookup (one `inArray` query per fan-out).
 * `tzByUser` maps a userId to its stored tz value; a `null` value (or an
 * omitted userId) means no preference row exists for that user.
 */
function makeTzDb(tzByUser: Record<number, string | null>) {
  const rows = Object.entries(tzByUser)
    .filter(([, tz]) => tz !== null)
    .map(([userId, tz]) => ({ userId: Number(userId), value: tz }));
  const where = jest.fn().mockResolvedValue(rows);
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  return { select } as unknown as NotifyPollVotersDeps['db'];
}

function makeNotifications(): NotifyMock {
  return {
    notifyAutoSignup: jest.fn().mockResolvedValue(undefined),
    notifyPollOutcome: jest.fn().mockResolvedValue(undefined),
  };
}

/** Assemble the helper deps with only what notifyPollVoters touches. */
function makeDeps(
  db: NotifyPollVotersDeps['db'],
  notifications: NotifyMock,
  defaultTimezone = 'UTC',
): NotifyPollVotersDeps {
  const settingsService = {
    getDefaultTimezone: jest.fn().mockResolvedValue(defaultTimezone),
  };
  return {
    db,
    settingsService: settingsService as never,
    notifications: notifications as never,
  };
}

/** Invoke notifyPollVoters with fixed eventId + gameName. */
function callNotifyVoters(
  deps: NotifyPollVotersDeps,
  args: {
    selected: { userId: number }[];
    others: { userId: number }[];
    chosenTime: string;
  },
): Promise<void> {
  return notifyPollVoters(
    deps,
    args.selected,
    args.others,
    args.chosenTime,
    99,
    'Game Night',
  );
}

describe('notifyPollVoters timezone (ROK-1112)', () => {
  // 2026-05-04T01:00:00Z is 9:00 PM EDT Sun May 3 / 1:00 AM UTC Mon May 4.
  const CHOSEN = '2026-05-04T01:00:00.000Z';

  it('DMs each auto-signed-up voter the time in their own timezone', async () => {
    const notifications = makeNotifications();
    // User A (selected) → America/New_York, User B (selected) → America/Los_Angeles.
    const db = makeTzDb({ 1: 'America/New_York', 2: 'America/Los_Angeles' });
    const deps = makeDeps(db, notifications);

    await callNotifyVoters(deps, {
      selected: [{ userId: 1 }, { userId: 2 }],
      others: [],
      chosenTime: CHOSEN,
    });

    const [, , msgA] = notifications.notifyAutoSignup.mock.calls[0];
    const [, , msgB] = notifications.notifyAutoSignup.mock.calls[1];
    expect(msgA).not.toBe(msgB);
    // EDT recipient: Sun May 3 9:00 PM, NOT next-day UTC.
    expect(msgA).toContain('Sun');
    expect(msgA).toContain('May 3');
    expect(msgA).toContain('9:00');
    expect(msgA).not.toContain('May 4');
    // PDT recipient: 6:00 PM same day.
    expect(msgB).toContain('6:00');
  });

  it('falls back to the guild default timezone when a voter has no preference', async () => {
    const notifications = makeNotifications();
    // No pref row → falls through to guild default America/New_York.
    const db = makeTzDb({ 7: null });
    const deps = makeDeps(db, notifications, 'America/New_York');

    await callNotifyVoters(deps, {
      selected: [{ userId: 7 }],
      others: [],
      chosenTime: CHOSEN,
    });

    const [, , msg] = notifications.notifyAutoSignup.mock.calls[0];
    expect(msg).toContain('May 3');
    expect(msg).not.toContain('May 4');
  });

  it('formats other-slot voters in their own timezone too', async () => {
    const notifications = makeNotifications();
    const db = makeTzDb({ 3: 'America/New_York' });
    const deps = makeDeps(db, notifications);

    await callNotifyVoters(deps, {
      selected: [],
      others: [{ userId: 3 }],
      chosenTime: CHOSEN,
    });

    const [, msg] = notifications.notifyPollOutcome.mock.calls[0];
    expect(msg).toContain('Sun');
    expect(msg).toContain('May 3');
  });
});
