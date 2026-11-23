/**
 * ROK-2272 S8 — the "poll deadline" pass of the 5-minute Core lock sweep
 * (`HubForumDiscordEventLockSweep`). A poll whose lineup phase deadline
 * passed (or whose lineup was archived) with nobody voting, opening or
 * syncing it never re-runs `syncPollDiscussion`, so its thread would stay
 * writable forever and its Discord post never lock. This pass finds those
 * threads and re-runs the S7 reconciler, which stamps `write_closes_at`
 * through `pollEndedAt` + 1 h — the query only picks candidates, the close
 * rule lives in one place (`poll-discussion.sync.ts`).
 */
import { Logger } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { Db } from '../hub-forum.queries';
import { syncPollDiscussion } from './poll-discussion.sync';

const logger = new Logger('PollDiscussionDeadline');

/** Candidates per tick; the rest wait for the next one. */
export const POLL_DEADLINE_BATCH = 50;

const t = schema.hubForumThreads;
const m = schema.communityLineupMatches;
const l = schema.communityLineups;

/** `pollEndedAt` as SQL: locked in / archived, or an event-free poll expired. */
function pollEndedBy(now: Date) {
  const at = sql`${now.toISOString()}::timestamptz`;
  return or(
    inArray(m.status, ['scheduled', 'archived']),
    and(
      isNull(m.linkedEventId),
      or(eq(l.status, 'archived'), sql`${l.phaseDeadline} <= ${at}`),
    ),
  );
}

/**
 * Match ids of live, still-open poll threads (attached, no close deadline
 * yet) whose poll has ended by `pollEndedAt`'s reading: the match is locked
 * in / archived, OR — for a poll tied to no event (a reschedule poll never
 * expires) — its lineup is archived or its `phase_deadline <= now`.
 */
export async function findExpiredOpenPollMatchIds(
  db: Db,
  now: Date,
  limit: number = POLL_DEADLINE_BATCH,
): Promise<number[]> {
  const rows = await db
    .select({ matchId: m.id })
    .from(t)
    .innerJoin(m, eq(m.id, t.matchId))
    .innerJoin(l, eq(l.id, m.lineupId))
    .where(
      and(
        isNotNull(t.matchId),
        isNull(t.eventDetachedAt),
        isNull(t.writeClosesAt),
        pollEndedBy(now),
      ),
    )
    .orderBy(t.id)
    .limit(limit);
  return rows.map((r) => r.matchId);
}

/**
 * Re-sync every expired open poll (S7 stamps the close time). One failing
 * poll is logged and skipped, never stops the rest. Returns how many synced.
 */
export async function syncExpiredPolls(db: Db, now: Date): Promise<number> {
  let synced = 0;
  for (const matchId of await findExpiredOpenPollMatchIds(db, now)) {
    try {
      await syncPollDiscussion(db, matchId, now);
      synced += 1;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      logger.warn(`Poll ${matchId} deadline sync failed: ${why}`);
    }
  }
  return synced;
}
