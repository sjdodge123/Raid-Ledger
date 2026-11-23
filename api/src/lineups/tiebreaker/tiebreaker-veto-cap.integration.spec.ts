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
 * callers are released once two backends are parked behind the holder:
 *   - old code: both counted 0 and are parked on their INSERT -> 2 rows;
 *   - fixed:    the second is parked on the tiebreaker row lock before it
 *               counts, so it sees the first veto and hits the cap.
 */
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../../common/testing/integration-helpers';
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

/**
 * Sessions parked behind `holderPid`, directly or one hop removed (the fixed
 * code parks the second caller on the first caller's tiebreaker row lock,
 * and the first caller is the one parked on the holder). Scoped to the
 * holder so unrelated lock waiters in the database never count.
 */
async function countParkedBehind(db: Db, holderPid: number): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM pg_stat_activity a
    WHERE ${holderPid} = ANY(pg_blocking_pids(a.pid))
       OR EXISTS (
         SELECT 1 FROM pg_stat_activity b
         WHERE ${holderPid} = ANY(pg_blocking_pids(b.pid))
           AND b.pid = ANY(pg_blocking_pids(a.pid)))`);
  return Number(rows[0]?.n ?? 0);
}

interface HeldLock {
  pid: number;
  release: () => void;
  done: Promise<void>;
}

/** Hold SHARE on the vetoes table (blocks INSERT, not SELECT). */
async function holdVetoInsertLock(db: Db): Promise<HeldLock> {
  const held = deferred();
  const release = deferred();
  let pid = 0;
  const done = db.transaction(async (tx) => {
    await tx.execute(
      sql`LOCK TABLE community_lineup_tiebreaker_vetoes IN SHARE MODE`,
    );
    const [row] = nonEmpty(
      await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`),
      'holder pid row',
    );
    pid = row.pid;
    held.resolve();
    await release.promise;
  });
  await held.promise;
  return { pid, release: release.resolve, done };
}

function outcomeOf(r: PromiseSettledResult<void>): string {
  if (r.status === 'fulfilled') return 'ok';
  return r.reason instanceof Error ? r.reason.message : String(r.reason);
}

let seq = 0;

async function insertGame(db: Db): Promise<number> {
  seq += 1;
  const [game] = nonEmpty(
    await db
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

async function insertMember(db: Db): Promise<number> {
  seq += 1;
  const [user] = nonEmpty(
    await db
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
async function insertTiebreaker(
  db: Db,
  adminId: number,
): Promise<TiebreakerRow> {
  const tiedGameIds = [await insertGame(db), await insertGame(db)];
  const [lineup] = nonEmpty(
    await db
      .insert(schema.communityLineups)
      .values({
        title: 'veto cap race',
        status: 'voting',
        createdBy: adminId,
        publicSlug: generatePublicSlug(),
      })
      .returning(),
    'lineup',
  );
  const [tb] = nonEmpty(
    await db
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

async function vetoRows(db: Db, tiebreakerId: number) {
  const V = schema.communityLineupTiebreakerVetoes;
  return db.select().from(V).where(eq(V.tiebreakerId, tiebreakerId));
}

function describeVetoCap() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('two users vetoing at once under a cap of 1: exactly one lands', async () => {
    const db = testApp.db;
    const tb = await insertTiebreaker(db, testApp.seed.adminUser.id);
    const [gameA, gameB] = tb.tiedGameIds;
    const userA = await insertMember(db);
    const userB = await insertMember(db);
    const lock = await holdVetoInsertLock(db);
    let racing: Promise<PromiseSettledResult<void>[]>;
    try {
      racing = Promise.allSettled([
        submitVeto(db, tb, userA, defined(gameA, 'game A')),
        submitVeto(db, tb, userB, defined(gameB, 'game B')),
      ]);
      await waitFor(async () => {
        expect(await countParkedBehind(db, lock.pid)).toBe(2);
      }, 10_000);
    } finally {
      lock.release();
      await lock.done;
    }
    const results = await racing;
    expect(results.map(outcomeOf).sort()).toEqual(['Veto cap reached', 'ok']);
    expect(await vetoRows(db, tb.id)).toHaveLength(1);
  }, 20_000);
}

describe(
  'tiebreaker veto cap under concurrency (integration)',
  describeVetoCap,
);
