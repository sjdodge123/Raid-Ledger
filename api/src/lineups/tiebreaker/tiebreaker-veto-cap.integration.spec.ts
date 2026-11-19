/**
 * Veto cap holds under concurrent vetoes (TECH-DEBT L2934, veto-cap part).
 *
 * `submitVeto` counts the existing vetoes and inserts inside one READ
 * COMMITTED transaction. Before the fix nothing serialised two DIFFERENT
 * users, so both could count 0 under a cap of 1 and both insert. The
 * per-user unique index only stops a same-user duplicate.
 *
 * The race is forced deterministically: a third connection holds SHARE on
 * the vetoes table, which lets SELECTs through but parks every INSERT. Both
 * callers are released once two backends are parked on a lock:
 *   - old code: both counted 0 and are parked on their INSERT -> 2 rows;
 *   - fixed:    the second is parked on the tiebreaker row lock before it
 *               counts, so it sees the first veto and hits the cap.
 */
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import { defined, nonEmpty } from '../../common/testing/narrow';
import { submitVeto } from './tiebreaker-veto.helpers';

type TiebreakerRow = typeof schema.communityLineupTiebreakers.$inferSelect;
type Db = TestApp['db'];

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Polls until `n` backends in this database are waiting on a lock. */
async function lockWaiters(db: Db, n: number): Promise<void> {
  for (;;) {
    const [row] = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND datname = current_database()`,
    );
    if ((row?.n ?? 0) >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Hold SHARE on the vetoes table (blocks INSERT, not SELECT). */
async function holdVetoInsertLock(db: Db) {
  const held = deferred();
  const release = deferred();
  const done = db.transaction(async (tx) => {
    await tx.execute(
      sql`LOCK TABLE community_lineup_tiebreaker_vetoes IN SHARE MODE`,
    );
    held.resolve();
    await release.promise;
  });
  await held.promise;
  return { release: release.resolve, done };
}

function outcomeOf(r: PromiseSettledResult<void>): string {
  if (r.status === 'fulfilled') return 'ok';
  return r.reason instanceof Error ? r.reason.message : String(r.reason);
}

function describeVetoCap() {
  let testApp: TestApp;
  let seq = 0;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function insertGame(): Promise<number> {
    seq += 1;
    const [game] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({
          name: `VetoCap${seq}`,
          slug: `veto-cap-${seq}-${Date.now()}`,
        })
        .returning(),
      'game',
    );
    return game.id;
  }

  async function insertMember(): Promise<number> {
    seq += 1;
    const [user] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:veto-cap-${seq}@test.local`,
          username: `veto-cap-${seq}`,
          role: 'member',
        })
        .returning(),
      'user',
    );
    return user.id;
  }

  /** Active veto tiebreaker over two tied games, so the cap is 1. */
  async function insertTiebreaker(): Promise<TiebreakerRow> {
    const tiedGameIds = [await insertGame(), await insertGame()];
    const [lineup] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineups)
        .values({
          title: 'veto cap race',
          status: 'voting',
          createdBy: testApp.seed.adminUser.id,
          publicSlug: generatePublicSlug(),
        })
        .returning(),
      'lineup',
    );
    const [tb] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineupTiebreakers)
        .values({
          lineupId: lineup.id,
          mode: 'veto',
          status: 'active',
          tiedGameIds,
          originalVoteCount: 2,
        })
        .returning(),
      'tiebreaker',
    );
    return tb;
  }

  async function vetoRows(tiebreakerId: number) {
    const V = schema.communityLineupTiebreakerVetoes;
    return testApp.db.select().from(V).where(eq(V.tiebreakerId, tiebreakerId));
  }

  it('two users vetoing at once under a cap of 1: exactly one lands', async () => {
    const tb = await insertTiebreaker();
    const [gameA, gameB] = tb.tiedGameIds;
    const userA = await insertMember();
    const userB = await insertMember();
    const lock = await holdVetoInsertLock(testApp.db);
    let racing: Promise<PromiseSettledResult<void>[]>;
    try {
      racing = Promise.allSettled([
        submitVeto(testApp.db, tb, userA, defined(gameA, 'game A')),
        submitVeto(testApp.db, tb, userB, defined(gameB, 'game B')),
      ]);
      await lockWaiters(testApp.db, 2);
    } finally {
      lock.release();
      await lock.done;
    }
    const results = await racing;
    expect(results.map(outcomeOf).sort()).toEqual(['Veto cap reached', 'ok']);
    expect(await vetoRows(tb.id)).toHaveLength(1);
  }, 20_000);
}

describe(
  'tiebreaker veto cap under concurrency (integration)',
  describeVetoCap,
);
