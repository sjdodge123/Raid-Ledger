/**
 * ROK-1270: the 6 additional FK direct-count queries layered on top of
 * ROK-1271's 16 direct-count slots. Extracted to a sibling file to keep
 * `games-dedup-audit.helpers.ts` under the 300-line ESLint cap.
 *
 * Order here is the contract: callers spread this array into
 * `buildDirectCountQueries`, whose combined results are destructured in
 * lockstep at the call site (see `games-dedup-audit.helpers.ts`). If you
 * reorder this list, update that destructure together — a swap is a silent bug.
 */
import { count, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

function takeCount(rows: { c: number }[]): number {
  return Number(rows[0]?.c ?? 0);
}

/** 6 new direct-count promises, in the lockstep order consumed by buildDirectCountQueries. */
export function buildExtraCountQueries(db: Db, id: number): Promise<number>[] {
  const c = () => count();
  return [
    db
      .select({ c: c() })
      .from(schema.communityLineupTiebreakerBracketMatchups)
      .where(eq(schema.communityLineupTiebreakerBracketMatchups.gameAId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.communityLineupTiebreakerBracketMatchups)
      .where(eq(schema.communityLineupTiebreakerBracketMatchups.gameBId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.communityLineupTiebreakerBracketMatchups)
      .where(
        eq(schema.communityLineupTiebreakerBracketMatchups.winnerGameId, id),
      )
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.communityLineupTiebreakerBracketVotes)
      .where(eq(schema.communityLineupTiebreakerBracketVotes.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.communityLineupTiebreakerVetoes)
      .where(eq(schema.communityLineupTiebreakerVetoes.gameId, id))
      .then(takeCount),
    db
      .select({ c: c() })
      .from(schema.playerIntensitySnapshots)
      .where(eq(schema.playerIntensitySnapshots.longestSessionGameId, id))
      .then(takeCount),
  ];
}
