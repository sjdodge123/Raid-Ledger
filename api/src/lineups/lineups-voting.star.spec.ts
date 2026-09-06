/**
 * ROK-1474 (A7) — `setStar` / `findUserStar`.
 *
 * These assert the STATEMENT SHAPE of the star write: which rows are touched,
 * in which order, inside one transaction. The end-to-end truth (a real row
 * with `rank = 1`) is covered by `lineup-star.integration.spec.ts`; what can
 * only be pinned here is the ordering that makes the invariants hold — the
 * previous star is cleared before the new one is written, and a cap rejection
 * happens BEFORE anything is cleared.
 */
import { BadRequestException } from '@nestjs/common';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  findUserStar,
  isGameNominated,
  setStar,
  STAR_LOCK_CLASS,
} from './lineups-voting.helpers';

type Db = Parameters<typeof setStar>[0];

const LINEUP = 7;
const USER = 42;
const GAME = 900;

let db: MockDb;

/**
 * The flat chain mock resolves whichever call is terminal. Only the FIRST
 * `.where()` chains (the existing-vote lookup, which continues into
 * `.limit()`); every later one is terminal, and the two `UPDATE`s discard
 * what they resolve to — so handing the vote count to all of them keeps the
 * mock insensitive to statement ORDER. That matters: a test that broke when
 * statements were reordered would fail for the wrong reason and prove
 * nothing about the ordering it claims to pin.
 */
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

describe('setStar', () => {
  it('stars an already-approved game by ranking its existing row', async () => {
    db.limit.mockResolvedValueOnce([{ id: 77 }]);

    const action = await setStar(db as unknown as Db, LINEUP, USER, GAME, 3);

    expect(action).toBe('set');
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.set.mock.calls.map((c) => c[0])).toEqual([
      { rank: null },
      { rank: 1 },
    ]);
  });

  it('stars an unapproved game by inserting the approval it implies', async () => {
    // AC1 / D2: no vote row exists, so one is created — starring cannot be
    // represented without its approval.
    db.limit.mockResolvedValueOnce([]);
    programWhere([{ count: 1 }]);

    const action = await setStar(db as unknown as Db, LINEUP, USER, GAME, 3);

    expect(action).toBe('set');
    expect(db.values).toHaveBeenCalledWith({
      lineupId: LINEUP,
      userId: USER,
      gameId: GAME,
      rank: 1,
    });
  });

  it('rejects a star that would exceed the vote cap, leaving the old star intact', async () => {
    // Q2: a star is an approval, so it is cap-checked like one. The cap check
    // runs BEFORE the clear — a rejected star must not silently strip the
    // voter's previous pick.
    db.limit.mockResolvedValueOnce([]);
    programWhere([{ count: 3 }]);

    await expect(
      setStar(db as unknown as Db, LINEUP, USER, GAME, 3),
    ).rejects.toThrow(
      new BadRequestException('Maximum 3 votes per lineup reached'),
    );
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('does not consume the cap when starring a game already approved', async () => {
    db.limit.mockResolvedValueOnce([{ id: 77 }]);
    programWhere([{ count: 3 }]);

    await expect(
      setStar(db as unknown as Db, LINEUP, USER, GAME, 3),
    ).resolves.toBe('set');
  });

  it('clears the star without reading or writing any vote row', async () => {
    const action = await setStar(db as unknown as Db, LINEUP, USER, null, 3);

    expect(action).toBe('cleared');
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith({ rank: null });
    expect(db.set).toHaveBeenCalledTimes(1);
  });

  it('moves the star inside a single transaction', async () => {
    db.limit.mockResolvedValueOnce([{ id: 88 }]);

    await setStar(db as unknown as Db, LINEUP, USER, GAME, 3);

    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  // ROK-1474: without this lock two concurrent stars by the same voter both
  // clear, both write, and the second dies on `uq_lineup_vote_user_rank` as an
  // unhandled 500. The lock is the ONLY defence — a try/catch cannot be one,
  // because under postgres.js a failed statement poisons the transaction.
  it('takes an advisory lock on (lineup, voter) keyed to the star class', async () => {
    db.limit.mockResolvedValueOnce([{ id: 88 }]);

    await setStar(db as unknown as Db, LINEUP, USER, GAME, 3);

    expect(db.execute).toHaveBeenCalledTimes(1);
    const issued = JSON.stringify(db.execute.mock.calls[0][0]);
    expect(issued).toContain('pg_advisory_xact_lock');
    expect(issued).toContain(String(STAR_LOCK_CLASS));
    expect(issued).toContain(`${LINEUP}:${USER}`);
  });

  it('holds the lock before any row is read or written', async () => {
    db.limit.mockResolvedValueOnce([{ id: 88 }]);

    await setStar(db as unknown as Db, LINEUP, USER, GAME, 3);

    // A lock taken after the read would leave the race wide open. Stated as a
    // pair of booleans so a MISSING lock reports `[false, false]` rather than
    // a `received value must be a number` matcher error.
    expect(db.execute).toHaveBeenCalledTimes(1);
    const lockedAt = db.execute.mock.invocationCallOrder[0];
    expect({
      beforeTheRead: lockedAt < db.select.mock.invocationCallOrder[0],
      beforeTheWrite: lockedAt < db.update.mock.invocationCallOrder[0],
    }).toEqual({ beforeTheRead: true, beforeTheWrite: true });
  });

  it('locks even when the star is only being cleared', async () => {
    await setStar(db as unknown as Db, LINEUP, USER, null, 3);

    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});

describe('isGameNominated', () => {
  it('is true when the lineup has an entry for the game', async () => {
    db.limit.mockResolvedValueOnce([{ id: 5 }]);

    await expect(
      isGameNominated(db as unknown as Db, LINEUP, GAME),
    ).resolves.toBe(true);
  });

  it('is false when the game was never nominated in this lineup', async () => {
    db.limit.mockResolvedValueOnce([]);

    await expect(
      isGameNominated(db as unknown as Db, LINEUP, GAME),
    ).resolves.toBe(false);
  });
});

describe('findUserStar', () => {
  it('returns the starred game id', async () => {
    db.limit.mockResolvedValueOnce([{ gameId: 123 }]);
    await expect(findUserStar(db as unknown as Db, LINEUP, USER)).resolves.toBe(
      123,
    );
  });

  it('returns null when the voter starred nothing', async () => {
    db.limit.mockResolvedValueOnce([]);
    await expect(
      findUserStar(db as unknown as Db, LINEUP, USER),
    ).resolves.toBeNull();
  });

  it('does not query at all for an anonymous viewer', async () => {
    await expect(
      findUserStar(db as unknown as Db, LINEUP, undefined),
    ).resolves.toBeNull();
    expect(db.select).not.toHaveBeenCalled();
  });
});
