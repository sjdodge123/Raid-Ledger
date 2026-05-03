/**
 * TDD unit tests for `resolveLineupReminderTargets` (ROK-1126).
 *
 * Covers AC #4: helper signature, public/private branches × nominate/vote/
 * schedule actions, plus edge cases (no invitees, no participants, all
 * already participated → empty array).
 *
 * The helper does not exist yet — this spec MUST fail on import until the
 * dev agent creates `lineup-reminder-target.helpers.ts`.
 */
import {
  resolveLineupReminderTargets,
  type ReminderAction,
} from './lineup-reminder-target.helpers';

// ---------------------------------------------------------------------------
// Mocked Drizzle: a single `db.execute` that returns whatever the test queues.
// Mirrors the pattern in `lineup-reminder.service.spec.ts`.
// ---------------------------------------------------------------------------

interface MockDb {
  execute: jest.Mock;
}

function makeMockDb(): MockDb {
  return { execute: jest.fn() };
}

const LINEUP_ID = 42;
const MATCH_ID = 100;

function lineup(visibility: 'public' | 'private', createdBy = 1) {
  return { id: LINEUP_ID, visibility, createdBy };
}

function user(id: number) {
  return { id, userId: id };
}

// ---------------------------------------------------------------------------

describe('resolveLineupReminderTargets', () => {
  let db: MockDb;

  beforeEach(() => {
    db = makeMockDb();
  });

  // ─── exported types / signature ──────────────────────────────────────────

  it('exports ReminderAction type union including nominate, vote, schedule', () => {
    // Compile-time check — if the type is missing or wrong this fails to compile.
    const actions: ReminderAction[] = ['nominate', 'vote', 'schedule'];
    expect(actions).toHaveLength(3);
  });

  it('returns Promise<number[]>', async () => {
    db.execute.mockResolvedValueOnce([lineup('public')]).mockResolvedValue([]);
    const result = await resolveLineupReminderTargets(
      db as unknown as Parameters<typeof resolveLineupReminderTargets>[0],
      LINEUP_ID,
      'nominate',
    );
    expect(Array.isArray(result)).toBe(true);
  });

  // ─── PRIVATE branch ──────────────────────────────────────────────────────

  describe('private lineup', () => {
    it('nominate → invitees + creator minus existing nominators', async () => {
      // 1) load lineup
      db.execute.mockResolvedValueOnce([lineup('private', 100)]);
      // 2) invitees ∪ {createdBy} (already deduped by helper) — invitees with discord_id
      db.execute.mockResolvedValueOnce([user(21), user(22)]);
      // 3) participants (already nominated)
      db.execute.mockResolvedValueOnce([{ userId: 21 }]);

      const result = await resolveLineupReminderTargets(
        db as unknown as Parameters<typeof resolveLineupReminderTargets>[0],
        LINEUP_ID,
        'nominate',
      );

      // 100 (creator) + 22 — 21 already nominated, dropped
      expect(new Set(result)).toEqual(new Set([100, 22]));
    });

    it('vote → invitees + creator minus existing voters', async () => {
      db.execute.mockResolvedValueOnce([lineup('private', 100)]);
      db.execute.mockResolvedValueOnce([user(31), user(32), user(33)]);
      db.execute.mockResolvedValueOnce([{ userId: 32 }]); // already voted

      const result = await resolveLineupReminderTargets(
        db as unknown as Parameters<typeof resolveLineupReminderTargets>[0],
        LINEUP_ID,
        'vote',
      );

      expect(new Set(result)).toEqual(new Set([100, 31, 33]));
    });

    it('schedule → invitees + creator minus existing schedule voters (matchId required)', async () => {
      db.execute.mockResolvedValueOnce([lineup('private', 100)]);
      db.execute.mockResolvedValueOnce([user(41), user(42)]);
      db.execute.mockResolvedValueOnce([{ userId: 41 }]);

      const result = await resolveLineupReminderTargets(
        db as unknown as Parameters<typeof resolveLineupReminderTargets>[0],
        LINEUP_ID,
        'schedule',
        MATCH_ID,
      );

      expect(new Set(result)).toEqual(new Set([100, 42]));
    });

    it('returns only the creator when there are no invitees', async () => {
      db.execute.mockResolvedValueOnce([lineup('private', 100)]);
      db.execute.mockResolvedValueOnce([]); // no invitees
      db.execute.mockResolvedValueOnce([]); // no participants

      const result = await resolveLineupReminderTargets(
        db as unknown as Parameters<typeof resolveLineupReminderTargets>[0],
        LINEUP_ID,
        'nominate',
      );

      expect(new Set(result)).toEqual(new Set([100]));
    });

    it('returns [] when every invitee + creator has already participated', async () => {
      db.execute.mockResolvedValueOnce([lineup('private', 100)]);
      db.execute.mockResolvedValueOnce([user(21), user(22)]);
      db.execute.mockResolvedValueOnce([
        { userId: 100 },
        { userId: 21 },
        { userId: 22 },
      ]);

      const result = await resolveLineupReminderTargets(
        db as unknown as Parameters<typeof resolveLineupReminderTargets>[0],
        LINEUP_ID,
        'vote',
      );

      expect(result).toEqual([]);
    });
  });

  // ─── PUBLIC branch ───────────────────────────────────────────────────────

  describe('public lineup', () => {
    it('nominate → all Discord-linked users minus existing nominators', async () => {
      db.execute.mockResolvedValueOnce([lineup('public', 1)]);
      // all discord-linked users
      db.execute.mockResolvedValueOnce([user(10), user(11), user(12)]);
      // existing nominators
      db.execute.mockResolvedValueOnce([{ userId: 11 }]);

      const result = await resolveLineupReminderTargets(
        db as unknown as Parameters<typeof resolveLineupReminderTargets>[0],
        LINEUP_ID,
        'nominate',
      );

      expect(new Set(result)).toEqual(new Set([10, 12]));
    });

    it('vote → participants so far (nominators ∪ voters) minus existing voters', async () => {
      db.execute.mockResolvedValueOnce([lineup('public', 1)]);
      // candidate set — nominators ∪ voters (helper may run a single union query)
      db.execute.mockResolvedValueOnce([user(20), user(21), user(22)]);
      // existing voters
      db.execute.mockResolvedValueOnce([{ userId: 22 }]);

      const result = await resolveLineupReminderTargets(
        db as unknown as Parameters<typeof resolveLineupReminderTargets>[0],
        LINEUP_ID,
        'vote',
      );

      expect(new Set(result)).toEqual(new Set([20, 21]));
    });

    it('schedule → match members (with discord_id) minus existing schedule voters', async () => {
      db.execute.mockResolvedValueOnce([lineup('public', 1)]);
      // match members
      db.execute.mockResolvedValueOnce([user(30), user(31)]);
      // existing schedule voters for this match
      db.execute.mockResolvedValueOnce([{ userId: 30 }]);

      const result = await resolveLineupReminderTargets(
        db as unknown as Parameters<typeof resolveLineupReminderTargets>[0],
        LINEUP_ID,
        'schedule',
        MATCH_ID,
      );

      expect(new Set(result)).toEqual(new Set([31]));
    });

    it('returns [] for vote action when no users have participated yet', async () => {
      db.execute.mockResolvedValueOnce([lineup('public', 1)]);
      db.execute.mockResolvedValueOnce([]); // nominators ∪ voters — empty
      db.execute.mockResolvedValueOnce([]);

      const result = await resolveLineupReminderTargets(
        db as unknown as Parameters<typeof resolveLineupReminderTargets>[0],
        LINEUP_ID,
        'vote',
      );

      expect(result).toEqual([]);
    });

    it('returns [] when every Discord-linked user has already nominated', async () => {
      db.execute.mockResolvedValueOnce([lineup('public', 1)]);
      db.execute.mockResolvedValueOnce([user(10), user(11)]);
      db.execute.mockResolvedValueOnce([{ userId: 10 }, { userId: 11 }]);

      const result = await resolveLineupReminderTargets(
        db as unknown as Parameters<typeof resolveLineupReminderTargets>[0],
        LINEUP_ID,
        'nominate',
      );

      expect(result).toEqual([]);
    });
  });

  // ─── Misc edge cases ─────────────────────────────────────────────────────

  it('returns [] if the lineup row does not exist', async () => {
    db.execute.mockResolvedValueOnce([]); // no lineup row

    const result = await resolveLineupReminderTargets(
      db as unknown as Parameters<typeof resolveLineupReminderTargets>[0],
      LINEUP_ID,
      'nominate',
    );

    expect(result).toEqual([]);
  });
});
