/**
 * Cohort-memory backfill migration integration tests (ROK-1309 S3, real DB).
 *
 * The tests read the REAL `0181_*.sql` off disk and execute it against pg16 —
 * reading the shipped file is what makes these regression pins rather than a
 * re-implementation of the SQL. The migration has of course already run (over
 * an empty table) during test-app boot; replaying it over seeded data is
 * exactly the production redeploy/restore shape we need to pin.
 *
 * Covers the three AC cases:
 *   1. decided + archived lineups produce the expected rows with the right
 *      participant_hash / cohort_size / resolution, and lineups still in
 *      building/voting produce none.
 *   2. a second replay is a no-op.
 *   3. a lineup with zero nominators AND zero voters produces no rows.
 *
 * Plus the one failure nothing else would catch: the SQL-computed
 * participant_hash must equal `hashParticipantIds` byte-for-byte, or
 * backfilled cohorts never match live-written ones and the feature silently
 * "has no data". The seeded ids (20000 / 70000 / 100000) sort DIFFERENTLY as
 * text than numerically ("100000" < "20000" < "70000"), so a SQL side that
 * sorted as text fails this file rather than passing it by luck.
 */
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import type { LineupStatus } from '../drizzle/schema/community-lineups';
import { hashParticipantIds } from './cohort-memory-signature.helpers';

const MIGRATIONS_DIR = path.join(__dirname, '../drizzle/migrations');

/** Ids chosen so a text sort and a numeric sort disagree. */
const COHORT_IDS = [70000, 20000, 100000];
const PAIR_IDS = [100000, 20000];
const ASC = (a: number, b: number) => a - b;

/** The shipped backfill statements, in file order. RED until 0181 exists. */
function loadBackfillStatements(): string[] {
  const match = fs
    .readdirSync(MIGRATIONS_DIR)
    .find((f) => /^0181_.*\.sql$/.test(f));
  if (!match) {
    throw new Error(
      '0181 cohort-memory backfill migration not found in ' +
        'api/src/drizzle/migrations — ROK-1309 S3 not yet authored',
    );
  }
  return fs
    .readFileSync(path.join(MIGRATIONS_DIR, match), 'utf8')
    .split('--> statement-breakpoint')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.replace(/^\s*--.*$/gm, '').trim().length > 0);
}

function describeCohortMemoryBackfill() {
  let testApp: TestApp;
  let adminId: number;
  let games: number[];
  let decidedLineup: number;
  let archivedLineup: number;
  let votingLineup: number;
  let emptyLineup: number;

  const db = () => testApp.db;
  const memoryRows = () =>
    db().select().from(schema.communityLineupCohortMemory);

  const runBackfill = async () => {
    for (const statement of loadBackfillStatements()) {
      await db().execute(sql.raw(statement));
    }
  };

  const rowsFor = async (lineupId: number) =>
    (await memoryRows())
      .filter((r) => r.sourceLineupId === lineupId)
      .map((r) => ({
        gameId: r.gameId,
        resolution: r.resolution,
        hash: r.participantHash,
        size: r.cohortSize,
        ids: r.participantIds,
      }));

  async function seedCohort(): Promise<void> {
    await db()
      .insert(schema.users)
      .values(
        COHORT_IDS.map((id) => ({
          id,
          discordId: `bf-cohort-${id}`,
          username: `bf${id}`,
          role: 'member' as const,
        })),
      );
    const gameRows = await db()
      .insert(schema.games)
      .values(
        [1, 2, 3].map((n) => ({
          name: `Backfill Game ${n}`,
          slug: `backfill-game-${n}`,
        })),
      )
      .returning();
    games = gameRows.map((g) => g.id);
  }

  async function makeLineup(
    title: string,
    slug: string,
    status: LineupStatus,
    decidedGameId: number | null,
  ): Promise<number> {
    const [row] = await db()
      .insert(schema.communityLineups)
      .values({
        title,
        status,
        visibility: 'public',
        createdBy: adminId,
        publicSlug: slug,
        decidedGameId,
      })
      .returning();
    return row.id;
  }

  /** Engage `userIds` on `lineupId`: one nomination each, all voting game 0. */
  async function engage(lineupId: number, userIds: number[]): Promise<void> {
    await db()
      .insert(schema.communityLineupEntries)
      .values(
        userIds.map((nominatedBy, i) => ({
          lineupId,
          gameId: games[i],
          nominatedBy,
        })),
      );
    await db()
      .insert(schema.communityLineupVotes)
      .values(
        userIds.map((userId) => ({ lineupId, userId, gameId: games[0] })),
      );
  }

  /** Match-tier row + a resolved veto on the decided lineup. */
  async function seedOutcomes(): Promise<void> {
    await db().insert(schema.communityLineupMatches).values({
      lineupId: decidedLineup,
      gameId: games[1],
      status: 'suggested',
      voteCount: 3,
    });
    await db()
      .insert(schema.communityLineupTiebreakers)
      .values({
        lineupId: decidedLineup,
        mode: 'veto',
        status: 'resolved',
        tiedGameIds: [games[1], games[2]],
        originalVoteCount: 3,
        winnerGameId: games[1],
        resolvedAt: new Date(),
      });
  }

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    const seed = await truncateAllTables(db());
    adminId = seed.adminUser.id;
    await seedCohort();

    decidedLineup = await makeLineup(
      'Decided',
      'bfslug01',
      'decided',
      games[0],
    );
    archivedLineup = await makeLineup(
      'Archived',
      'bfslug02',
      'archived',
      games[2],
    );
    votingLineup = await makeLineup('Voting', 'bfslug03', 'voting', null);
    emptyLineup = await makeLineup('Empty', 'bfslug04', 'decided', games[0]);

    await engage(decidedLineup, COHORT_IDS);
    await engage(archivedLineup, PAIR_IDS);
    await engage(votingLineup, COHORT_IDS);
    await seedOutcomes();
    // emptyLineup is deliberately left with zero entries and zero votes.
  });

  it('backfills decided + archived lineups and skips unresolved ones', async () => {
    await runBackfill();

    const decidedRows = await rowsFor(decidedLineup);
    expect(
      decidedRows.map((r) => `${r.resolution}:${r.gameId}`).sort(),
    ).toEqual(
      [
        `decided:${games[0]}`,
        `match:${games[1]}`,
        `veto_won:${games[1]}`,
        `veto_lost:${games[2]}`,
      ].sort(),
    );
    const decidedHash = hashParticipantIds([...COHORT_IDS].sort(ASC));
    for (const row of decidedRows) {
      expect(row.hash).toBe(decidedHash);
      expect(row.size).toBe(3);
      expect(row.ids).toEqual([...COHORT_IDS].sort(ASC));
    }

    const archivedRows = await rowsFor(archivedLineup);
    expect(archivedRows).toHaveLength(1);
    expect(archivedRows[0]).toMatchObject({
      gameId: games[2],
      resolution: 'decided',
      size: 2,
      hash: hashParticipantIds([...PAIR_IDS].sort(ASC)),
    });

    expect(await rowsFor(votingLineup)).toHaveLength(0);
  });

  it("computes participant_hash identically to S2's TypeScript helper", async () => {
    await runBackfill();

    // Numeric-vs-text sort trap: "100000" < "20000" < "70000" as text.
    const sorted = [...COHORT_IDS].sort(ASC);
    expect(sorted).toEqual([20000, 70000, 100000]);
    const textSorted = [...COHORT_IDS].sort();
    expect(textSorted).not.toEqual(sorted);

    const rows = await rowsFor(decidedLineup);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.hash).toBe(hashParticipantIds(sorted));
      expect(row.hash).not.toBe(hashParticipantIds(textSorted));
    }
  });

  it('is a no-op on replay', async () => {
    await runBackfill();
    const before = (await memoryRows()).length;
    expect(before).toBeGreaterThan(0);

    await runBackfill();

    expect((await memoryRows()).length).toBe(before);
  });

  it('replay safety comes from the unique constraint, not from luck', async () => {
    await runBackfill();

    // Non-vacuous pin for the test above: with the ON CONFLICT guard removed
    // the same statement MUST be rejected by uq_cl_cohort_memory_row. If this
    // ever passes, the "no-op on replay" assertion is proving nothing.
    const unguarded = loadBackfillStatements().map((s) =>
      s
        .replace(/^\s*--.*$/gm, '')
        .replace(/ON CONFLICT[\s\S]*?DO NOTHING/i, ''),
    );
    expect(unguarded.join('\n')).not.toMatch(/ON CONFLICT/i);
    const rejection = await db()
      .execute(sql.raw(unguarded[0]))
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(rejection).not.toBeNull();
    // Drizzle wraps the driver error, so assert against the CAUSE — matching
    // the wrapper's "Failed query:" text would pass for any SQL error at all.
    const cause = (rejection as { cause?: unknown }).cause;
    expect(String(cause)).toMatch(
      /duplicate key value violates unique constraint "uq_cl_cohort_memory_row"/i,
    );
  });

  it('writes nothing for a lineup with zero nominators AND zero voters', async () => {
    await runBackfill();

    expect(await rowsFor(emptyLineup)).toHaveLength(0);
  });
}

describe(
  'Cohort memory backfill migration (integration)',
  describeCohortMemoryBackfill,
);
