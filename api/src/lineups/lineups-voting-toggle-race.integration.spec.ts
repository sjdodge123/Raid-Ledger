/**
 * TDB:1064 — two concurrent `toggleVote` calls by the same voter (real DB).
 *
 * `toggleVote` reads (existing vote, vote count) then writes. Under READ
 * COMMITTED neither racer sees the other's uncommitted row, so without a lock:
 *   - the same game twice → both INSERT, the loser dies on
 *     `uq_lineup_vote_user_game` (an unhandled HTTP 500);
 *   - two games at `maxVotes = 1` → both pass the count, two rows land.
 *
 * The interleaving is forced, not hoped for: a blocker transaction holds
 * UNCOMMITTED rows for the same (lineup, user, game) keys, so an unlocked
 * toggle reads nothing and then parks on the unique index behind it. Once
 * both racers are parked the blocker rolls back and lets them go. With the
 * voter lock the second racer parks on the lock instead, and reads the
 * first racer's COMMITTED row when it gets through.
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { toggleVote } from './lineups-voting.helpers';
import { nonEmpty } from '../common/testing/narrow';

type Db = TestApp['db'];
type VoteKey = { lineupId: number; userId: number; gameId: number };

const ROLLBACK = new Error('blocker rollback');

/** Sessions parked behind `blockerPid`, directly or one hop removed. */
async function countParkedBehind(db: Db, blockerPid: number): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM pg_stat_activity a
    WHERE ${blockerPid} = ANY(pg_blocking_pids(a.pid))
       OR EXISTS (
         SELECT 1 FROM pg_stat_activity b
         WHERE ${blockerPid} = ANY(pg_blocking_pids(b.pid))
           AND b.pid = ANY(pg_blocking_pids(a.pid)))`);
  return Number(rows[0]?.n ?? 0);
}

/** Describe a settled toggle as a sortable string. */
function outcome(r: PromiseSettledResult<'added' | 'removed'>): string {
  return r.status === 'fulfilled'
    ? r.value
    : `rejected: ${(r.reason as Error).message}`;
}

/**
 * Hold `held` uncommitted, start both toggles, wait until both are parked,
 * then roll the blocker back and return how each toggle ended.
 */
async function raceBehindBlocker(
  db: Db,
  held: VoteKey[],
  toggles: Array<() => Promise<'added' | 'removed'>>,
): Promise<string[]> {
  let settled!: Promise<PromiseSettledResult<'added' | 'removed'>[]>;
  await db
    .transaction(async (tx) => {
      await tx.insert(schema.communityLineupVotes).values(held);
      const [{ pid }] = nonEmpty(
        await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`),
        'backend pid row',
      );
      settled = Promise.allSettled(toggles.map((t) => t()));
      await waitFor(async () => {
        expect(await countParkedBehind(db, pid)).toBe(toggles.length);
      }, 10_000);
      throw ROLLBACK;
    })
    .catch((err: unknown) => {
      if ((err as Error)?.message !== ROLLBACK.message) throw err;
    });
  return (await settled).map(outcome).sort();
}

/** A `voting` lineup owned by `userId`, plus a second game to vote on. */
async function seedVotingLineup(
  db: Db,
  userId: number,
): Promise<{ lineupId: number; gameB: number }> {
  const [other] = nonEmpty(
    await db
      .insert(schema.games)
      .values({ name: 'Toggle Race B', slug: `toggle-race-b-${Date.now()}` })
      .returning(),
    'other',
  );
  const [lineup] = nonEmpty(
    await db
      .insert(schema.communityLineups)
      .values({
        title: 'Toggle race',
        status: 'voting',
        visibility: 'public',
        createdBy: userId,
        publicSlug: `tglrace${Date.now() % 1e8}`,
      })
      .returning(),
    'lineup',
  );
  return { lineupId: lineup.id, gameB: other.id };
}

function describeToggleVoteRace() {
  let testApp: TestApp;
  let lineupId: number;
  let userId: number;
  let gameA: number;
  let gameB: number;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    userId = testApp.seed.adminUser.id;
    gameA = testApp.seed.game.id;
    ({ lineupId, gameB } = await seedVotingLineup(testApp.db, userId));
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function voteRowCount(): Promise<number> {
    const rows = await testApp.db.select().from(schema.communityLineupVotes);
    return rows.length;
  }

  it('a double toggle of one game adds then removes — never a duplicate-key error', async () => {
    const toggle = () => toggleVote(testApp.db, lineupId, userId, gameA, 3);

    const outcomes = await raceBehindBlocker(
      testApp.db,
      [{ lineupId, userId, gameId: gameA }],
      [toggle, toggle],
    );

    expect({ outcomes, rows: await voteRowCount() }).toEqual({
      outcomes: ['added', 'removed'],
      rows: 0,
    });
  });

  it('two games at the last free vote cannot both land past maxVotes', async () => {
    const toggle = (gameId: number) => () =>
      toggleVote(testApp.db, lineupId, userId, gameId, 1);

    const outcomes = await raceBehindBlocker(
      testApp.db,
      [
        { lineupId, userId, gameId: gameA },
        { lineupId, userId, gameId: gameB },
      ],
      [toggle(gameA), toggle(gameB)],
    );

    expect({ outcomes, rows: await voteRowCount() }).toEqual({
      outcomes: ['added', 'rejected: Maximum 1 votes per lineup reached'],
      rows: 1,
    });
  });
}

describe('toggleVote concurrency (TDB:1064)', describeToggleVoteRace);
