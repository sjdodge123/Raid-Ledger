/**
 * Regression tests for recipient-timezone rendering of lineup event-created
 * DMs (ROK-1112).
 *
 * Both the public ("locked in for …") and private-invitee event-created DM
 * bodies previously formatted the start date in the SERVER timezone, so a late
 * evening event in a western tz leaked the next-day UTC date to every recipient
 * regardless of their preference. These tests prove two recipients with
 * different IANA prefs receive DIFFERENT date strings for the same start time,
 * and that a missing/`'auto'` pref falls through to the guild default.
 */
import {
  fanOutEventCreatedDMs,
  fanOutEventCreatedDMsToInvitees,
} from './lineup-notification-dm-batch.helpers';
import type { MatchInfo } from './lineup-notification.service';

// 2026-05-04T01:00:00Z == 9:00 PM EDT Sun May 3 / 6:00 PM PDT Sun May 3 /
// 1:00 AM UTC Mon May 4 — the boundary case that rolls into the next UTC day.
const EVENT_DATE = new Date('2026-05-04T01:00:00.000Z');

// Only id/lineupId/gameName are read by the fan-outs under test.
const MATCH = {
  id: 500,
  lineupId: 900,
  gameName: 'Final Fantasy XIV',
} as unknown as MatchInfo;

interface CreateCall {
  userId: number;
  message: string;
}

function makeNotificationService() {
  const create = jest.fn().mockResolvedValue({ id: 'n' });
  return {
    service: { create } as never,
    calls: () =>
      create.mock.calls.map(([arg]: [CreateCall]) => ({
        userId: arg.userId,
        message: arg.message,
      })),
  };
}

/** Dedup that always allows the DM through (never already-sent). */
const dedupAllow = {
  checkAndMarkSent: jest.fn().mockResolvedValue(false),
} as never;

/**
 * DB mock: `select().from().where()` resolves the queued timezone preference
 * rows; `execute()` resolves the queued invitee member rows.
 */
function makeDb(opts: {
  tzRows: { userId: number; value: string }[];
  members?: {
    id: number;
    userId: number;
    displayName: string;
    discordId: string;
  }[];
}) {
  const where = jest.fn().mockResolvedValue(opts.tzRows);
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  const execute = jest.fn().mockResolvedValue(opts.members ?? []);
  // ROK-1131: findInviteeDiscordMembers is now a typed selectDistinct chain
  // (was raw db.execute) — resolve it from the same members queue. The plain
  // select().from().where() chain keeps serving tzRows (and the never-awaited
  // invitee/creator subquery builders).
  const selectDistinct = jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockImplementation(() => execute()),
    }),
  });
  return { select, selectDistinct, execute } as never;
}

const MEMBER_A = {
  id: 1,
  userId: 1,
  displayName: 'Ayla',
  discordId: 'd1',
};
const MEMBER_B = {
  id: 2,
  userId: 2,
  displayName: 'Borin',
  discordId: 'd2',
};

describe('fanOutEventCreatedDMs recipient timezone (ROK-1112)', () => {
  it('renders each recipient the locked-in date in their own timezone', async () => {
    const { service, calls } = makeNotificationService();
    const db = makeDb({
      tzRows: [
        { userId: 1, value: 'America/New_York' },
        { userId: 2, value: 'America/Los_Angeles' },
      ],
    });

    await fanOutEventCreatedDMs(
      db,
      service,
      dedupAllow,
      MATCH,
      EVENT_DATE,
      777,
      [MEMBER_A, MEMBER_B],
      'UTC',
    );

    const [a, b] = calls();
    expect(a.message).not.toBe(b.message);
    // EDT recipient: Sun, May 3 — NOT the next-day UTC date.
    expect(a.message).toContain('Sun');
    expect(a.message).toContain('May 3');
    expect(a.message).not.toContain('May 4');
    // PDT recipient: 6:00 PM same evening.
    expect(b.message).toContain('6:00');
  });

  it('falls back to the guild default when a recipient has no tz preference', async () => {
    const { service, calls } = makeNotificationService();
    // No pref rows → both fall through to guild default America/New_York.
    const db = makeDb({ tzRows: [] });

    await fanOutEventCreatedDMs(
      db,
      service,
      dedupAllow,
      MATCH,
      EVENT_DATE,
      777,
      [MEMBER_A],
      'America/New_York',
    );

    const [a] = calls();
    expect(a.message).toContain('May 3');
    expect(a.message).not.toContain('May 4');
  });

  it("treats the 'auto' sentinel as no preference (guild default)", async () => {
    const { service, calls } = makeNotificationService();
    const db = makeDb({ tzRows: [{ userId: 1, value: 'auto' }] });

    await fanOutEventCreatedDMs(
      db,
      service,
      dedupAllow,
      MATCH,
      EVENT_DATE,
      777,
      [MEMBER_A],
      'America/Los_Angeles',
    );

    const [a] = calls();
    // PDT default → 6:00 PM Sun May 3.
    expect(a.message).toContain('6:00');
    expect(a.message).toContain('May 3');
  });
});

describe('fanOutEventCreatedDMsToInvitees recipient timezone (ROK-1112)', () => {
  it('renders each private invitee the locked-in date in their own timezone', async () => {
    const { service, calls } = makeNotificationService();
    const db = makeDb({
      members: [MEMBER_A, MEMBER_B],
      tzRows: [
        { userId: 1, value: 'America/New_York' },
        { userId: 2, value: 'America/Los_Angeles' },
      ],
    });

    await fanOutEventCreatedDMsToInvitees(
      db,
      service,
      dedupAllow,
      MATCH,
      EVENT_DATE,
      777,
      'UTC',
    );

    const [a, b] = calls();
    expect(a.message).not.toBe(b.message);
    expect(a.message).toContain('Sun');
    expect(a.message).toContain('May 3');
    expect(a.message).not.toContain('May 4');
    expect(b.message).toContain('6:00');
  });
});
