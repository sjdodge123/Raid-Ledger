/**
 * TDB:1064 — `toggleVote` serialises on the voter's advisory lock.
 *
 * `toggleVote` is a READ (existing vote, vote count) followed by a separate
 * WRITE. Without the lock, two concurrent toggles by the same voter both miss
 * each other's uncommitted row: a double-click on one game dies on
 * `uq_lineup_vote_user_game` (HTTP 500) and two games at once overshoot
 * `maxVotesPerPlayer`. The real-DB proof of both outcomes lives in
 * `lineups-voting-toggle-race.integration.spec.ts`; this pins the ordering
 * that makes it hold — the lock comes before any row is read or written.
 */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { STAR_LOCK_CLASS, toggleVote } from './lineups-voting.helpers';

type Db = Parameters<typeof toggleVote>[0];

const LINEUP = 7;
const USER = 42;
const GAME = 900;

let db: MockDb;

/**
 * `.where()` either chains into `.limit()` (existing vote, nomination check)
 * or is awaited directly (the vote count), whatever order the helper reads in.
 */
function programWhere(countRows: unknown[] = [{ count: 0 }]): void {
  db.where.mockImplementation(() => ({
    limit: db.limit,
    then: (resolve: (rows: unknown[]) => unknown) => resolve(countRows),
  }));
}

const NOMINATED = [{ id: 5 }];

beforeEach(() => {
  db = createDrizzleMock();
  programWhere();
});

describe('toggleVote — voter lock (TDB:1064)', () => {
  it('takes the (lineup, voter) advisory lock shared with setStar', async () => {
    db.limit.mockResolvedValueOnce([]).mockResolvedValueOnce(NOMINATED);

    await toggleVote(db as unknown as Db, LINEUP, USER, GAME, 3);

    expect(db.execute).toHaveBeenCalledTimes(1);
    const issued = JSON.stringify(db.execute.mock.calls[0][0]);
    expect(issued).toContain('pg_advisory_xact_lock');
    expect(issued).toContain(String(STAR_LOCK_CLASS));
    expect(issued).toContain(`${LINEUP}:${USER}`);
  });

  it('holds the lock before the vote is read or inserted', async () => {
    db.limit.mockResolvedValueOnce([]).mockResolvedValueOnce(NOMINATED);

    const action = await toggleVote(db as unknown as Db, LINEUP, USER, GAME, 3);

    // Stated as booleans so a MISSING lock reports `false` rather than a
    // `received value must be a number` matcher error. A missing read or
    // insert falls back to -Infinity, so it reports `false` the same way.
    const lockedAt = db.execute.mock.invocationCallOrder[0] ?? Infinity;
    const readAt = db.select.mock.invocationCallOrder[0] ?? -Infinity;
    const insertAt = db.insert.mock.invocationCallOrder[0] ?? -Infinity;
    expect({
      action,
      beforeTheRead: lockedAt < readAt,
      beforeTheWrite: lockedAt < insertAt,
    }).toEqual({ action: 'added', beforeTheRead: true, beforeTheWrite: true });
  });

  it('holds the lock before an existing vote is removed', async () => {
    db.limit.mockResolvedValueOnce([{ id: 77 }]);

    const action = await toggleVote(db as unknown as Db, LINEUP, USER, GAME, 3);

    const lockedAt = db.execute.mock.invocationCallOrder[0] ?? Infinity;
    const deleteAt = db.delete.mock.invocationCallOrder[0] ?? -Infinity;
    expect({
      action,
      beforeTheDelete: lockedAt < deleteAt,
    }).toEqual({ action: 'removed', beforeTheDelete: true });
  });
});

describe('toggleVote — nomination guard', () => {
  it('rejects a vote on a game never nominated in the lineup', async () => {
    db.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      toggleVote(db as unknown as Db, LINEUP, USER, GAME, 3),
    ).rejects.toThrow('Game is not nominated in this lineup');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('still removes an existing vote without the nomination check', async () => {
    db.limit.mockResolvedValueOnce([{ id: 77 }]).mockResolvedValueOnce([]);

    const action = await toggleVote(db as unknown as Db, LINEUP, USER, GAME, 3);

    expect(action).toBe('removed');
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
