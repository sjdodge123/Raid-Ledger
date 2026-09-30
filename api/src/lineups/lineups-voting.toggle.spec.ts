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

/** First `.where()` chains into `.limit()`; later ones resolve the count. */
function programWhere(countRows: unknown[] = [{ count: 0 }]): void {
  let calls = 0;
  db.where.mockImplementation(() =>
    (calls += 1) === 1 ? db : Promise.resolve(countRows),
  );
}

beforeEach(() => {
  db = createDrizzleMock();
  programWhere();
});

describe('toggleVote — voter lock (TDB:1064)', () => {
  it('takes the (lineup, voter) advisory lock shared with setStar', async () => {
    db.limit.mockResolvedValueOnce([]);

    await toggleVote(db as unknown as Db, LINEUP, USER, GAME, 3);

    expect(db.execute).toHaveBeenCalledTimes(1);
    const issued = JSON.stringify(db.execute.mock.calls[0][0]);
    expect(issued).toContain('pg_advisory_xact_lock');
    expect(issued).toContain(String(STAR_LOCK_CLASS));
    expect(issued).toContain(`${LINEUP}:${USER}`);
  });

  it('holds the lock before the vote is read or inserted', async () => {
    db.limit.mockResolvedValueOnce([]);

    const action = await toggleVote(db as unknown as Db, LINEUP, USER, GAME, 3);

    // Stated as booleans so a MISSING lock reports `false` rather than a
    // `received value must be a number` matcher error.
    const lockedAt = db.execute.mock.invocationCallOrder[0] ?? Infinity;
    expect({
      action,
      beforeTheRead: lockedAt < db.select.mock.invocationCallOrder[0],
      beforeTheWrite: lockedAt < db.insert.mock.invocationCallOrder[0],
    }).toEqual({ action: 'added', beforeTheRead: true, beforeTheWrite: true });
  });

  it('holds the lock before an existing vote is removed', async () => {
    db.limit.mockResolvedValueOnce([{ id: 77 }]);

    const action = await toggleVote(db as unknown as Db, LINEUP, USER, GAME, 3);

    const lockedAt = db.execute.mock.invocationCallOrder[0] ?? Infinity;
    expect({
      action,
      beforeTheDelete: lockedAt < db.delete.mock.invocationCallOrder[0],
    }).toEqual({ action: 'removed', beforeTheDelete: true });
  });
});
