/**
 * Auto-carryover helpers for community lineups (ROK-937).
 * Copies suggested match entries from a previous lineup to a new one.
 */
import { and, desc, eq, ne, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

const CARRYOVER_STATUSES = ['decided', 'archived'] as const;

/** Find the most recent lineup in decided or archived status. */
async function findPreviousLineup(db: Db, excludeId: number) {
  return db
    .select({ id: schema.communityLineups.id })
    .from(schema.communityLineups)
    .where(
      and(
        ne(schema.communityLineups.id, excludeId),
        inArray(schema.communityLineups.status, [...CARRYOVER_STATUSES]),
      ),
    )
    .orderBy(desc(schema.communityLineups.createdAt))
    .limit(1);
}

/** Find all suggested matches for a lineup. */
async function findSuggestedMatches(db: Db, lineupId: number) {
  return db
    .select({
      gameId: schema.communityLineupMatches.gameId,
      voteCount: schema.communityLineupMatches.voteCount,
    })
    .from(schema.communityLineupMatches)
    .where(
      and(
        eq(schema.communityLineupMatches.lineupId, lineupId),
        eq(schema.communityLineupMatches.status, 'suggested'),
      ),
    );
}

/** Find the original nominator for a game in a lineup. */
async function findOriginalNominator(db: Db, lineupId: number, gameId: number) {
  return db
    .select({ nominatedBy: schema.communityLineupEntries.nominatedBy })
    .from(schema.communityLineupEntries)
    .where(
      and(
        eq(schema.communityLineupEntries.lineupId, lineupId),
        eq(schema.communityLineupEntries.gameId, gameId),
      ),
    )
    .limit(1);
}

/** Insert a carried-over entry into the new lineup. */
async function insertCarriedEntry(
  db: Db,
  newLineupId: number,
  gameId: number,
  nominatedBy: number,
  oldLineupId: number,
) {
  await db.insert(schema.communityLineupEntries).values({
    lineupId: newLineupId,
    gameId,
    nominatedBy,
    carriedOverFrom: oldLineupId,
  });
}

/**
 * Carry over suggested match entries from the most recent
 * decided/archived lineup into a new lineup.
 */
export async function carryOverFromLastDecided(
  db: Db,
  newLineupId: number,
): Promise<void> {
  const [prev] = await findPreviousLineup(db, newLineupId);
  if (!prev) return;

  const suggestedMatches = await findSuggestedMatches(db, prev.id);
  if (suggestedMatches.length === 0) return;

  for (const match of suggestedMatches) {
    const [entry] = await findOriginalNominator(db, prev.id, match.gameId);
    const nominatedBy = entry?.nominatedBy ?? 0;
    await insertCarriedEntry(
      db,
      newLineupId,
      match.gameId,
      nominatedBy,
      prev.id,
    );
  }
}
