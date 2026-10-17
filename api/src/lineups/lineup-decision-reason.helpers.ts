/**
 * ROK-1474 (C3) — the seam that hands the Discord decided card its reasoning.
 *
 * Its own file rather than a method on the dispatch helper: the decided
 * notification chain (`fireDecidedNotifications` → `notifyMatchesFound` →
 * `orchestrateMatchesFound` → `buildDecidedEmbed`) carries only the match
 * list, and `lineup-notification-public-dispatch.helpers.ts` has no room for
 * a second reader.
 *
 * Nothing is stored (D9): votes freeze the moment a lineup leaves `voting`,
 * so re-deriving here yields the same string the web response shows and the
 * two surfaces cannot drift apart.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  deriveDecisionReason,
  loadStarCounts,
} from './lineups-response-star.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Why this lineup decided what it decided, or `null` when there is nothing
 * honest to say.
 *
 * Null covers three cases the decided card must stay silent about: the ballot
 * is still open, the lineup decided without naming a winner, and the lineup is
 * gone. The fourth — a winner a human picked by hand — is rejected one level
 * down by `describeStarOutcome`'s D9 clause (b).
 *
 * @param db - Drizzle database handle.
 * @param lineupId - Lineup whose outcome is being announced.
 */
export async function loadDecisionReason(
  db: Db,
  lineupId: number,
): Promise<string | null> {
  const [row] = await db
    .select({
      id: schema.communityLineups.id,
      status: schema.communityLineups.status,
      decidedGameId: schema.communityLineups.decidedGameId,
    })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!row || row.status !== 'decided' || row.decidedGameId === null) {
    return null;
  }
  const counts = await loadStarCounts(db, lineupId);
  return deriveDecisionReason(db, row, counts);
}
