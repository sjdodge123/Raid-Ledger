/**
 * TDB:489: migration 0195 gives community_lineup_matches.status /
 * threshold_met / vote_count the DB-level defaults the Drizzle schema has
 * always declared. 0104 created status and vote_count NOT NULL with no
 * default (0113's restatement sits behind CREATE TABLE IF NOT EXISTS and never
 * fires), so an ORM insert omitting them — legal per `$inferInsert` — failed
 * with a not-null violation on "status".
 *
 * The harness DB runs the full migration chain, so it takes the 0104 path and
 * both tests go red if 0195 is reverted. The insert runs in a rolled-back
 * transaction and leaks nothing to other specs.
 */
import { sql, TransactionRollbackError } from 'drizzle-orm';
import * as schema from './schema';
import { getTestApp, type TestApp } from '../common/testing/test-app';

type DefaultedFields = Pick<
  typeof schema.communityLineupMatches.$inferSelect,
  'status' | 'thresholdMet' | 'voteCount'
>;

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

/** Postgres' error text, unwrapped from drizzle's "Failed query" wrapper. */
function pgMessage(err: unknown): string {
  const cause = (err as { cause?: unknown }).cause;
  return cause instanceof Error ? cause.message : String(err);
}

/** Inserts a match with only its FKs, returning the defaulted fields — or the insert error. */
async function insertMatchOmittingDefaults(): Promise<
  DefaultedFields | { error: string }
> {
  let result: DefaultedFields | { error: string } = { error: 'no result' };
  try {
    await testApp.db.transaction(async (tx) => {
      const [lineup] = await tx
        .insert(schema.communityLineups)
        .values({
          title: 'TDB:489 defaults',
          status: 'decided',
          visibility: 'public',
          createdBy: testApp.seed.adminUser.id,
          publicSlug: 'tdb489-defaults',
        })
        .returning({ id: schema.communityLineups.id });
      try {
        const [match] = await tx
          .insert(schema.communityLineupMatches)
          .values({ lineupId: lineup.id, gameId: testApp.seed.game.id })
          .returning();
        const { status, thresholdMet, voteCount } = match;
        result = { status, thresholdMet, voteCount };
      } catch (err) {
        result = { error: pgMessage(err) };
      }
      tx.rollback();
    });
  } catch (err) {
    if (!(err instanceof TransactionRollbackError)) throw err;
  }
  return result;
}

describe('community_lineup_matches column defaults (TDB:489)', () => {
  it('declares the schema defaults at the database level', async () => {
    const rows = (await testApp.db.execute(sql`
      SELECT column_name AS name, column_default AS def
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'community_lineup_matches'
        AND column_name IN ('status', 'threshold_met', 'vote_count')`)) as unknown as Array<{
      name: string;
      def: string | null;
    }>;
    expect(Object.fromEntries(rows.map((r) => [r.name, r.def]))).toEqual({
      status: "'suggested'::text",
      threshold_met: 'false',
      vote_count: '0',
    });
  });

  it('accepts an ORM insert that omits status, thresholdMet and voteCount', async () => {
    await expect(insertMatchOmittingDefaults()).resolves.toEqual({
      status: 'suggested',
      thresholdMet: false,
      voteCount: 0,
    });
  });
});
