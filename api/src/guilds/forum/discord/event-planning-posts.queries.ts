/**
 * ROK-2272 S4a — reads and writes over `event_planning_posts`, the registry
 * of Discord-only posts for subjects with no hub. Plain statements only: the
 * insert reports the two expected races as tagged results instead of
 * throwing, so no caller ever catches inside a transaction.
 */
import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNull,
  ne,
  notExists,
  sql,
} from 'drizzle-orm';
import { pgErrorCode } from '../../../common/pg-error.helpers';
import * as schema from '../../../drizzle/schema';
import type { EventPlanningPostSelect } from '../../../drizzle/schema/event-planning-posts';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const posts = schema.eventPlanningPosts;

/** What a registry post is about (`subject_kind`). */
export type PlanningSubjectKind = 'event' | 'poll' | 'lineup';

/** A new registry row. */
export interface NewPlanningPost {
  subjectKind: PlanningSubjectKind;
  subjectId: number;
  forumId: number;
  discordThreadId: string;
  closesAt: Date | null;
}

/**
 * `no-forum`: the forum row vanished (FK 23503). `exists`: another writer
 * already holds the live post for this subject (23505 on
 * `uq_event_planning_posts_subject_live`).
 */
export type InsertPlanningPostResult =
  | { status: 'ok'; row: EventPlanningPostSelect }
  | { status: 'no-forum' }
  | { status: 'exists' };

/** The live (not deleted) post for a subject, or null. */
export async function findLivePlanningPost(
  db: ForumDiscordDb,
  kind: PlanningSubjectKind,
  subjectId: number,
): Promise<EventPlanningPostSelect | null> {
  const [row] = await db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.subjectKind, kind),
        eq(posts.subjectId, subjectId),
        isNull(posts.discordDeletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Insert a registry row. A 23505 counts as `exists` only when a live row for
 * the subject is really there (the thread-id unique is never expected to
 * collide; anything else is rethrown).
 */
export async function insertPlanningPost(
  db: ForumDiscordDb,
  post: NewPlanningPost,
): Promise<InsertPlanningPostResult> {
  try {
    const [row] = await db.insert(posts).values(post).returning();
    if (!row) throw new Error('event_planning_posts insert returned no row');
    return { status: 'ok', row };
  } catch (err) {
    const code = pgErrorCode(err);
    if (code === '23503') return { status: 'no-forum' };
    if (code !== '23505') throw err;
    const live = await findLivePlanningPost(
      db,
      post.subjectKind,
      post.subjectId,
    );
    if (live) return { status: 'exists' };
    throw err;
  }
}

/**
 * ROK-2272 S10 — live, unlocked `poll` posts with no `closes_at` yet, id >
 * `afterId`, in id order (the deadline pass: a `phase_deadline` expiry
 * emits nothing).
 */
export async function findOpenPlanningPollPosts(
  db: ForumDiscordDb,
  afterId: number,
  limit: number,
): Promise<{ id: number; subjectId: number }[]> {
  return db
    .select({ id: posts.id, subjectId: posts.subjectId })
    .from(posts)
    .where(
      and(
        eq(posts.subjectKind, 'poll'),
        gt(posts.id, afterId),
        isNull(posts.discordDeletedAt),
        isNull(posts.discordLockedAt),
        isNull(posts.closesAt),
      ),
    )
    .orderBy(asc(posts.id))
    .limit(limit);
}

/**
 * ROK-2287 — the lineup catch-up's candidates: voting lineups on the
 * planning path (the SQL twin of `lineupEligible`: no hub, not private, not
 * a standalone carrier) with NO registry row at all, newest first. A row
 * marked deleted counts (a moderator's delete is not undone, operator Q1);
 * a lineup past its effective deadline (`phase_deadline`, else the legacy
 * `voting_deadline` — the reminders' precedence) is skipped (operator Q2).
 * Only lineups created AFTER `forumId`'s forum row qualify, so a newly
 * bound forum is never back-filled with older lineups (none when the forum
 * row is gone). `community_lineups.created_at` is a UTC `timestamp` (no
 * zone), the forum's a `timestamptz`: the lineup's is read as UTC.
 */
export async function findVotingLineupsWithoutPlanningPost(
  db: ForumDiscordDb,
  forumId: number,
  now: Date,
  limit: number,
): Promise<number[]> {
  const l = schema.communityLineups;
  const anyRow = db
    .select({ one: sql`1` })
    .from(posts)
    .where(and(eq(posts.subjectKind, 'lineup'), eq(posts.subjectId, l.id)));
  const rows = await db
    .select({ id: l.id })
    .from(l)
    .where(
      and(
        eq(l.status, 'voting'),
        isNull(l.guildId),
        ne(l.visibility, 'private'),
        // Mirrors `override?.standalone === true` (findLineupForSync).
        sql`(${l.phaseDurationOverride} -> 'standalone') is distinct from 'true'::jsonb`,
        beforeEffectiveDeadline(now),
        createdAfterForum(forumId),
        notExists(anyRow),
      ),
    )
    .orderBy(desc(l.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Q2: `coalesce(phase_deadline, voting_deadline)` unset or still ahead. */
function beforeEffectiveDeadline(now: Date) {
  const l = schema.communityLineups;
  const deadline = sql`coalesce(${l.phaseDeadline}, ${l.votingDeadline})`;
  return sql`(${deadline} is null or ${deadline} > ${now.toISOString()}::timestamptz)`;
}

/** The lineup (UTC `timestamp`) is newer than the forum row (`timestamptz`). */
function createdAfterForum(forumId: number) {
  const l = schema.communityLineups;
  const f = schema.hubForumDiscordForums;
  return sql`(${l.createdAt} at time zone 'UTC') > (select ${f.createdAt} from ${f} where ${f.id} = ${forumId})`;
}

/** Set when the sweep closes the post. */
export async function setPlanningPostClosesAt(
  db: ForumDiscordDb,
  postId: number,
  closesAt: Date | null,
): Promise<void> {
  await db.update(posts).set({ closesAt }).where(eq(posts.id, postId));
}

/** Record the post as locked (`at`) or unlocked (null). */
export async function setPlanningPostLocked(
  db: ForumDiscordDb,
  postId: number,
  at: Date | null,
): Promise<void> {
  await db
    .update(posts)
    .set({ discordLockedAt: at })
    .where(eq(posts.id, postId));
}

/** The Discord post is gone: the row stops being live. */
export async function markPlanningPostDeleted(
  db: ForumDiscordDb,
  postId: number,
  at: Date,
): Promise<void> {
  await db
    .update(posts)
    .set({ discordDeletedAt: at })
    .where(eq(posts.id, postId));
}

/**
 * ROK-2272 S4 review MAJOR-2: the Discord thread of a live registry post is
 * gone (moderator delete). Marks it deleted, so the subject can get a fresh
 * post; true when a live row was marked.
 */
export async function markPlanningThreadDeleted(
  db: ForumDiscordDb,
  discordThreadId: string,
  at: Date,
): Promise<boolean> {
  const rows = await db
    .update(posts)
    .set({ discordDeletedAt: at })
    .where(
      and(
        eq(posts.discordThreadId, discordThreadId),
        isNull(posts.discordDeletedAt),
      ),
    )
    .returning({ id: posts.id });
  return rows.length > 0;
}

/** Inbound thread-delete of a non-hub post: imports nothing, DMs nobody. */
export async function planningThreadDeleted(
  db: ForumDiscordDb,
  discordThreadId: string,
  at: Date,
): Promise<'deleted' | 'skipped'> {
  const marked = await markPlanningThreadDeleted(db, discordThreadId, at);
  return marked ? 'deleted' : 'skipped';
}

/** The event fields a non-hub event post needs. */
export interface PlanningEventSource {
  title: string;
  start: Date;
  end: Date;
  guildId: number | null;
  isAdHoc: boolean;
  cancelledAt: Date | null;
}

/** An event's post-relevant fields; null once the event is gone. */
export async function findPlanningEvent(
  db: ForumDiscordDb,
  eventId: number,
): Promise<PlanningEventSource | null> {
  const e = schema.events;
  const [row] = await db
    .select({
      title: e.title,
      duration: e.duration,
      guildId: e.guildId,
      isAdHoc: e.isAdHoc,
      cancelledAt: e.cancelledAt,
    })
    .from(e)
    .where(eq(e.id, eventId))
    .limit(1);
  if (!row) return null;
  const { duration, ...rest } = row;
  return { ...rest, start: duration[0], end: duration[1] };
}

/** Tag ids the hubs bound to `forumId` own (kind tags must avoid them). */
export async function hubTagIdsOfForum(
  db: ForumDiscordDb,
  forumId: number,
): Promise<(string | null)[]> {
  const b = schema.hubForumDiscordBindings;
  const rows = await db
    .select({ tagId: b.tagId })
    .from(b)
    .where(eq(b.forumId, forumId));
  return rows.map((r) => r.tagId);
}
