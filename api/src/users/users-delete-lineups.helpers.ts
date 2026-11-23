/**
 * The community-lineup step of user deletion / data wipe: delete every lineup
 * the user created (children cascade), clearing the one RESTRICT back-reference
 * into them first. Runs in the caller's transaction.
 *
 * `hub_forum_threads.lineup_id` / `.match_id` carry no FK, so the delete alone
 * leaves the lineup's and its scheduling polls' hub threads attached (and open)
 * forever. They are closed + detached first with the same writes the discussion
 * reconcilers use when a lineup or poll is gone. Cleanup of withdrawn data runs
 * regardless of plugin activation.
 */
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { detachLineupThreads } from '../guilds/forum/subject-discussion/lineup-discussion.queries';
import { detachPollThreads } from '../guilds/forum/subject-discussion/poll-discussion.queries';

type Db = PostgresJsDatabase<typeof schema>;

/** Close + detach the hub threads of the user's lineups and their polls. */
async function detachUserLineupThreads(tx: Db, userId: number): Promise<void> {
  const l = schema.communityLineups;
  const m = schema.communityLineupMatches;
  const lineups = await tx
    .select({ id: l.id })
    .from(l)
    .where(eq(l.createdBy, userId));
  if (lineups.length === 0) return;
  const lineupIds = lineups.map((r) => r.id);
  const matches = await tx
    .select({ id: m.id })
    .from(m)
    .where(inArray(m.lineupId, lineupIds));
  const now = new Date();
  for (const id of lineupIds) await detachLineupThreads(tx, id, now);
  for (const { id } of matches) await detachPollThreads(tx, id, now);
}

/** Delete the lineups `userId` created. */
export async function deleteUserLineups(tx: Db, userId: number): Promise<void> {
  await detachUserLineupThreads(tx, userId);
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
