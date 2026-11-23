/**
 * ROK-2272 S7a — scheduling-poll discussion reads/writes: the poll (match)
 * row the reconciler needs, the poll's live thread, the polls of a lineup,
 * and the close + detach write. A poll is a `community_lineup_matches` row; its hub
 * is its lineup's `guild_id` (spec §3.1). Thread rows reuse
 * `event_detached_at` / `write_closes_at` for the poll subject (R8).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { DbOrTx } from '../event-discussion/event-discussion.queries';

/** A match status (`community_lineup_matches.status`). */
export type PollMatchStatus =
  (typeof schema.communityLineupMatches.$inferSelect)['status'];

/** What the poll reconciler reads from the match + its lineup + game. */
export interface PollSyncRow {
  matchId: number;
  lineupId: number;
  status: PollMatchStatus;
  /** Parent lineup status — `archived` ends a still-`scheduling` poll. */
  lineupStatus: (typeof schema.communityLineups.$inferSelect)['status'];
  /** Parent lineup `phase_deadline` — a passed one expires the poll. */
  phaseDeadline: Date | null;
  /** Event the match produced / reschedules — such a poll never expires. */
  linkedEventId: number | null;
  /**
   * ROK-2295: the title of the event this poll RESCHEDULES. Null when
   * unlinked, when the event is gone, and for a poll that PRODUCED its event
   * at lock-in (`events.created_from_poll_id` = this match — the same
   * reading as `standalone-poll-auth.helpers.ts`).
   */
  linkedEventTitle: string | null;
  guildId: number | null;
  visibility: 'public' | 'private';
  creatorId: number;
  gameName: string;
  /** The storage lineup row's title (a standalone poll's own title). */
  lineupTitle: string;
  /** `phase_duration_override.standalone` — a standalone scheduling poll. */
  standalone: boolean;
}

/** The poll's live (attached) thread — at most one (partial unique index). */
export interface LivePollThread {
  id: number;
  guildId: number;
  title: string;
  body: string;
  writeClosesAt: Date | null;
}

/** The poll row, or null when the match (or its lineup) is gone. */
export async function findPollForSync(
  db: DbOrTx,
  matchId: number,
): Promise<PollSyncRow | null> {
  const m = schema.communityLineupMatches;
  const l = schema.communityLineups;
  const [row] = await db
    .select({
      matchId: m.id,
      lineupId: m.lineupId,
      status: m.status,
      lineupStatus: l.status,
      phaseDeadline: l.phaseDeadline,
      linkedEventId: m.linkedEventId,
      eventTitle: schema.events.title,
      eventFromPollId: schema.events.createdFromPollId,
      guildId: l.guildId,
      visibility: l.visibility,
      creatorId: l.createdBy,
      gameName: schema.games.name,
      lineupTitle: l.title,
      override: l.phaseDurationOverride,
    })
    .from(m)
    .innerJoin(l, eq(l.id, m.lineupId))
    .innerJoin(schema.games, eq(schema.games.id, m.gameId))
    .leftJoin(schema.events, eq(schema.events.id, m.linkedEventId))
    .where(eq(m.id, matchId))
    .limit(1);
  if (!row) return null;
  const { override, eventTitle, eventFromPollId, ...rest } = row;
  const produced = eventFromPollId === matchId;
  return {
    ...rest,
    linkedEventTitle: produced ? null : eventTitle,
    standalone: override?.standalone === true,
  };
}

/** The poll's live (attached) thread, or null. */
export async function findLivePollThread(
  db: DbOrTx,
  matchId: number,
): Promise<LivePollThread | null> {
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
    .where(and(eq(t.matchId, matchId), isNull(t.eventDetachedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Every match id of a lineup that is or was a poll (not `suggested`), for
 * lineup-level emits (`STATUS_CHANGED`). Includes standalone carriers.
 */
export async function findPollMatchIds(
  db: DbOrTx,
  lineupId: number,
): Promise<number[]> {
  const m = schema.communityLineupMatches;
  const rows = await db
    .select({ id: m.id })
    .from(m)
    .where(and(eq(m.lineupId, lineupId), sql`${m.status} <> 'suggested'`));
  return rows.map((r) => r.id);
}

/**
 * Close + detach the poll's live thread (R6: private flip, hub removed, poll
 * gone). Read-only from now: the deadline is pulled to `now` unless an
 * earlier one is already stored.
 */
export async function detachPollThreads(
  db: DbOrTx,
  matchId: number,
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
    .where(and(eq(t.matchId, matchId), isNull(t.eventDetachedAt)));
}
