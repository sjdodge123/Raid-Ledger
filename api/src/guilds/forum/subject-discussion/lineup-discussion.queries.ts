/**
 * ROK-2272 S7b — community-lineup discussion reads/writes: the lineup row the
 * reconciler needs, the lineup's live thread, and the close + detach write.
 * A lineup's hub is its `guild_id` (spec §3.1); thread rows key on
 * `hub_forum_threads.lineup_id` and reuse `event_detached_at` /
 * `write_closes_at` for the lineup subject (R8).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { DbOrTx } from '../event-discussion/event-discussion.queries';

/** A lineup status (`community_lineups.status`). */
export type LineupSubjectStatus =
  (typeof schema.communityLineups.$inferSelect)['status'];

/** What the lineup reconciler reads from `community_lineups`. */
export interface LineupSyncRow {
  lineupId: number;
  title: string;
  status: LineupSubjectStatus;
  guildId: number | null;
  visibility: 'public' | 'private';
  creatorId: number;
  /** A standalone poll's hidden carrier row — never a lineup subject (§3.1). */
  standalone: boolean;
}

/** The lineup's live (attached) thread — at most one (partial unique index). */
export interface LiveLineupThread {
  id: number;
  guildId: number;
  title: string;
  body: string;
  writeClosesAt: Date | null;
}

/** The lineup row, or null when it is gone. */
export async function findLineupForSync(
  db: DbOrTx,
  lineupId: number,
): Promise<LineupSyncRow | null> {
  const l = schema.communityLineups;
  const [row] = await db
    .select({
      lineupId: l.id,
      title: l.title,
      status: l.status,
      guildId: l.guildId,
      visibility: l.visibility,
      creatorId: l.createdBy,
      override: l.phaseDurationOverride,
    })
    .from(l)
    .where(eq(l.id, lineupId))
    .limit(1);
  if (!row) return null;
  const { override, ...rest } = row;
  return { ...rest, standalone: override?.standalone === true };
}

/** The lineup's live (attached) thread, or null. */
export async function findLiveLineupThread(
  db: DbOrTx,
  lineupId: number,
): Promise<LiveLineupThread | null> {
  const t = schema.hubForumThreads;
  const [row] = await db
    .select({
      id: t.id,
      guildId: t.guildId,
      title: t.title,
      body: t.body,
      writeClosesAt: t.writeClosesAt,
    })
    .from(t)
    .where(and(eq(t.lineupId, lineupId), isNull(t.eventDetachedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Close + detach the lineup's live thread (R6: private flip, hub removed,
 * lineup gone). The deadline is pulled to `now` unless an earlier one is
 * already stored.
 */
export async function detachLineupThreads(
  db: DbOrTx,
  lineupId: number,
  now: Date = new Date(),
): Promise<void> {
  const t = schema.hubForumThreads;
  const iso = now.toISOString();
  await db
    .update(t)
    .set({
      eventDetachedAt: now,
      writeClosesAt: sql`least(coalesce(${t.writeClosesAt}, ${iso}::timestamptz), ${iso}::timestamptz)`,
      updatedAt: now,
    })
    .where(and(eq(t.lineupId, lineupId), isNull(t.eventDetachedAt)));
}
