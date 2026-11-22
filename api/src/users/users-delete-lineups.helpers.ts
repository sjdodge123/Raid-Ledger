/**
 * The community-lineup step of user deletion / data wipe: delete every lineup
 * the user created (children cascade), clearing the one RESTRICT back-reference
 * into them first. Runs in the caller's transaction.
 *
 * `hub_forum_threads.lineup_id` / `.match_id` carry no FK, so the delete alone
 * leaves the lineup's and its scheduling polls' hub threads attached (and open)
 * forever. They are closed + detached first with the same writes the discussion
 * reconcilers use when a lineup or poll is gone, each under that subject's
 * discussion advisory lock (ascending id order) so a reconciler mid-insert
 * cannot re-attach a thread after the detach. `lockUserForWipe` takes those
 * locks before the user row (deadlock-safe order). Cleanup of withdrawn data runs
 * regardless of plugin activation.
 */
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { DbOrTx } from '../guilds/forum/event-discussion/event-discussion.queries';
import {
  detachLineupThreads,
  lockLineupDiscussion,
} from '../guilds/forum/subject-discussion/lineup-discussion.queries';
import {
  detachPollThreads,
  lockPollDiscussion,
} from '../guilds/forum/subject-discussion/poll-discussion.queries';
import { selectUserScreenshotPaths } from '../feedback/feedback-screenshot-user.helpers';

/** The ids of the user's lineups and of their scheduling polls, ascending. */
async function selectUserDiscussionIds(
  tx: DbOrTx,
  userId: number,
): Promise<{ lineupIds: number[]; matchIds: number[] }> {
  const l = schema.communityLineups;
  const m = schema.communityLineupMatches;
  const lineups = await tx
    .select({ id: l.id })
    .from(l)
    .where(eq(l.createdBy, userId))
    .orderBy(l.id);
  const lineupIds = lineups.map((r) => r.id);
  if (lineupIds.length === 0) return { lineupIds, matchIds: [] };
  const matches = await tx
    .select({ id: m.id })
    .from(m)
    .where(inArray(m.lineupId, lineupIds))
    .orderBy(m.id);
  return { lineupIds, matchIds: matches.map((r) => r.id) };
}

/** Take the discussion advisory locks of the user's lineups, then their polls. */
async function lockUserDiscussions(tx: DbOrTx, userId: number): Promise<void> {
  const { lineupIds, matchIds } = await selectUserDiscussionIds(tx, userId);
  for (const id of lineupIds) await lockLineupDiscussion(tx, id);
  for (const id of matchIds) await lockPollDiscussion(tx, id);
}

/**
 * The opening locks of a user delete / ban-wipe transaction, in the one safe
 * order: the user's lineup + poll discussion advisory locks FIRST, then the
 * user row (`selectUserScreenshotPaths` locks it FOR UPDATE). A reconciler
 * holds that advisory lock while its thread INSERT waits on the users row
 * (`authorId` FK, FOR KEY SHARE) — taking the row first closes a deadlock
 * cycle and Postgres aborts the delete. Returns the screenshot paths.
 */
export async function lockUserForWipe(
  tx: Parameters<typeof selectUserScreenshotPaths>[0],
  userId: number,
): Promise<string[]> {
  await lockUserDiscussions(tx, userId);
  return selectUserScreenshotPaths(tx, userId);
}

/**
 * Close + detach the hub threads of the user's lineups and their polls. The
 * locks are normally already held (`lockUserForWipe`); re-taking one is a
 * no-op, and it covers a lineup/poll created before the user row was locked.
 */
async function detachUserLineupThreads(
  tx: DbOrTx,
  userId: number,
): Promise<void> {
  const { lineupIds, matchIds } = await selectUserDiscussionIds(tx, userId);
  const now = new Date();
  for (const id of lineupIds) {
    await lockLineupDiscussion(tx, id);
    await detachLineupThreads(tx, id, now);
  }
  for (const id of matchIds) {
    await lockPollDiscussion(tx, id);
    await detachPollThreads(tx, id, now);
  }
}

/** Delete the lineups `userId` created. */
export async function deleteUserLineups(
  tx: DbOrTx,
  userId: number,
): Promise<void> {
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
