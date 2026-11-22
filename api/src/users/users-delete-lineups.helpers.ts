/**
 * The community-lineup step of user deletion / data wipe: delete every lineup
 * the user created (children cascade), clearing the one RESTRICT back-reference
 * into them first. Runs in the caller's transaction.
 */
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Delete the lineups `userId` created. */
export async function deleteUserLineups(tx: Db, userId: number): Promise<void> {
  // `community_lineup_entries.carried_over_from` is the ONLY non-cascade (RESTRICT)
  // back-reference to community_lineups.id: carryOverFromLastDecided() inserts
  // entries in a NEWER lineup pointing at an older one. If the user created that
  // older lineup, a surviving newer lineup's entry would RESTRICT-block the delete
  // below. Null those back-refs first (nullable; only feeds a display boolean).
  const userLineupIds = tx
    .select({ id: schema.communityLineups.id })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.createdBy, userId));
  await tx
    .update(schema.communityLineupEntries)
    .set({ carriedOverFrom: null })
    .where(
      inArray(schema.communityLineupEntries.carriedOverFrom, userLineupIds),
    );
  // Deleting the lineup cascades all of its children (child→lineup FKs cascade).
  await tx
    .delete(schema.communityLineups)
    .where(eq(schema.communityLineups.createdBy, userId));
}
