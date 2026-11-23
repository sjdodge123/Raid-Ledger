/**
 * ROK-2208 D3 — the link row IS the outbox: `origin='raidledger' AND
 * sync_state <> 'synced'` is the retry queue the S6 sweep drains.
 *
 * A create is claimed BEFORE Discord answers (so a crash or a failure leaves
 * a retryable row), but `discord_message_id` is NOT NULL UNIQUE — so an
 * unsent row carries a placeholder id `rl:<t|r>:<rl id>` (no schema change),
 * replaced by the real snowflake on success. `isUnsent` tells them apart.
 */
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const links = schema.hubForumDiscordLinks;

/** One link row. */
export type ForumLink = schema.HubForumDiscordLinkSelect;

/** Placeholder prefix for a row whose Discord message does not exist yet. */
export const UNSENT_PREFIX = 'rl:';

/** The placeholder id for an unsent thread (`t`) or reply (`r`). */
export function unsentId(kind: 'thread' | 'reply', id: number): string {
  return `${UNSENT_PREFIX}${kind === 'thread' ? 't' : 'r'}:${id}`;
}

/** The row's Discord message was never created. */
export function isUnsent(link: Pick<ForumLink, 'discordMessageId'>): boolean {
  return link.discordMessageId.startsWith(UNSENT_PREFIX);
}

/** R3: only RL-origin, sent, still-present rows are pushed on edit. */
export function isEditableLink(link: ForumLink): boolean {
  return (
    link.origin === 'raidledger' && !link.discordDeletedAt && !isUnsent(link)
  );
}

/** Claim an outbound create; null when a link already exists (idempotent). */
export async function claimLink(
  db: ForumDiscordDb,
  row: Pick<
    schema.HubForumDiscordLinkInsert,
    'guildId' | 'kind' | 'threadId' | 'replyId' | 'discordThreadId'
  > & { discordMessageId: string },
): Promise<ForumLink | null> {
  const [link] = await db
    .insert(links)
    .values({ ...row, origin: 'raidledger', syncState: 'pending' })
    .onConflictDoNothing()
    .returning();
  return link ?? null;
}

/** Claim an RL thread's post (placeholder ids until it is sent). */
export function claimThreadLink(
  db: ForumDiscordDb,
  guildId: number,
  threadId: number,
): Promise<ForumLink | null> {
  const placeholder = unsentId('thread', threadId);
  return claimLink(db, {
    guildId,
    kind: 'thread',
    threadId,
    replyId: null,
    discordThreadId: placeholder,
    discordMessageId: placeholder,
  });
}

/** Claim an RL reply's message inside its (maybe still unsent) post. */
export function claimReplyLink(
  db: ForumDiscordDb,
  row: {
    guildId: number;
    threadId: number;
    replyId: number;
    discordThreadId: string;
  },
): Promise<ForumLink | null> {
  return claimLink(db, {
    ...row,
    kind: 'reply',
    discordMessageId: unsentId('reply', row.replyId),
  });
}

/** The link of an RL thread (its forum post), if any. */
export async function findThreadLink(
  db: ForumDiscordDb,
  threadId: number,
): Promise<ForumLink | null> {
  const [link] = await db
    .select()
    .from(links)
    .where(and(eq(links.threadId, threadId), eq(links.kind, 'thread')))
    .limit(1);
  return link ?? null;
}

/** The link of an RL reply, if any. */
export async function findReplyLink(
  db: ForumDiscordDb,
  replyId: number,
): Promise<ForumLink | null> {
  const [link] = await db
    .select()
    .from(links)
    .where(eq(links.replyId, replyId))
    .limit(1);
  return link ?? null;
}

/** A create landed: store the real ids and mark synced. */
export async function markSent(
  db: ForumDiscordDb,
  linkId: number,
  ids: { threadId: string; messageId: string },
  now: Date,
): Promise<void> {
  await db
    .update(links)
    .set({
      discordThreadId: ids.threadId,
      discordMessageId: ids.messageId,
      syncState: 'synced',
      attempts: 0,
      lastError: null,
      syncedAt: now,
    })
    .where(eq(links.id, linkId));
}

/** An edit landed (or Discord said 404 — nothing left to retry). */
export async function markSynced(
  db: ForumDiscordDb,
  linkId: number,
  now: Date,
): Promise<void> {
  await db
    .update(links)
    .set({ syncState: 'synced', attempts: 0, lastError: null, syncedAt: now })
    .where(eq(links.id, linkId));
}

/** The Discord side was deleted (by us, or it was already gone). */
export async function markDeleted(
  db: ForumDiscordDb,
  linkId: number,
  now: Date,
): Promise<void> {
  await db
    .update(links)
    .set({
      syncState: 'synced',
      attempts: 0,
      lastError: null,
      discordDeletedAt: now,
    })
    .where(eq(links.id, linkId));
}

/** A Discord call failed: retryable by the S6 sweep. */
export async function markFailed(
  db: ForumDiscordDb,
  linkId: number,
  error: string,
): Promise<void> {
  await db
    .update(links)
    .set({
      syncState: 'failed',
      attempts: sql`${links.attempts} + 1`,
      lastError: error.slice(0, 500),
    })
    .where(eq(links.id, linkId));
}

/** The sweep's limits (`sync-rules` owns the numbers). */
export interface RetryPolicy {
  maxAttempts: number;
  graceMs: number;
  stepMs: number;
}

/** RL-origin pending/failed rows, or a failed Discord-origin one (Codex P2). */
const retryableState = () =>
  or(
    and(
      eq(links.origin, 'raidledger'),
      inArray(links.syncState, ['pending', 'failed']),
    ),
    and(eq(links.origin, 'discord'), eq(links.syncState, 'failed')),
  );

/**
 * §5.6 sweep queue: RL-origin rows of still-BOUND hubs, pending/failed under
 * the attempts cap, plus FAILED Discord-origin rows (Codex P2: only an RL
 * moderation delete ever fails one; `retryOp` never echoes them otherwise), posts before replies (a reply needs its post's real id).
 * Unbound hubs drop out so their rows never crowd the queue (D9). Review
 * MAJOR-3: the backoff (`isRetryDue`) is applied HERE, before the LIMIT, so
 * not-yet-due rows can never starve a due one.
 */
export async function retryableLinks(
  db: ForumDiscordDb,
  now: Date,
  policy: RetryPolicy,
  limit = 100,
): Promise<ForumLink[]> {
  const bound = schema.hubForumDiscordBindings;
  const delayMs = sql`CASE WHEN ${links.attempts} <= 0 THEN ${policy.graceMs}::float8
    ELSE ${policy.stepMs}::float8 * (power(2, ${links.attempts}) - 1) END`;
  const due = sql`coalesce(${links.syncedAt}, ${links.createdAt}) <=
    ${now.toISOString()}::timestamptz - (${delayMs}) * interval '1 millisecond'`;
  const rows = await db
    .select({ link: links })
    .from(links)
    .innerJoin(bound, eq(bound.guildId, links.guildId))
    .where(and(retryableState(), lt(links.attempts, policy.maxAttempts), due))
    .orderBy(desc(links.kind), asc(links.id))
    .limit(limit);
  return rows.map((r) => r.link);
}

/** One link by id (the sweep re-reads it after a retry). */
export async function findLinkById(
  db: ForumDiscordDb,
  linkId: number,
): Promise<ForumLink | null> {
  const [link] = await db.select().from(links).where(eq(links.id, linkId));
  return link ?? null;
}

/** Review MAJOR-3: close a row nothing can ever send out of the queue. */
export async function markAbandoned(
  db: ForumDiscordDb,
  linkId: number,
  reason: string,
  maxAttempts: number,
): Promise<void> {
  await db
    .update(links)
    .set({
      syncState: 'failed',
      attempts: sql`greatest(${links.attempts}, ${maxAttempts}::int)`,
      lastError: reason.slice(0, 500),
    })
    .where(eq(links.id, linkId));
}

/** When the RL thread was created; null once it is gone (review MAJOR-2). */
export async function threadCreatedAt(
  db: ForumDiscordDb,
  threadId: number,
): Promise<Date | null> {
  const t = schema.hubForumThreads;
  const [row] = await db
    .select({ createdAt: t.createdAt })
    .from(t)
    .where(eq(t.id, threadId));
  return row?.createdAt ?? null;
}

/** The RL thread/reply behind a link was deleted on RL (or is gone). */
export async function rlRowDeleted(
  db: ForumDiscordDb,
  link: Pick<ForumLink, 'threadId' | 'replyId'>,
): Promise<boolean> {
  const t = schema.hubForumThreads;
  const r = schema.hubForumReplies;
  const [row] =
    link.replyId === null
      ? await db
          .select({ deletedAt: t.deletedAt })
          .from(t)
          .where(eq(t.id, link.threadId))
      : await db
          .select({ deletedAt: r.deletedAt })
          .from(r)
          .where(eq(r.id, link.replyId));
  return !row || row.deletedAt !== null;
}

/** Every message id linked inside one Discord post (placeholders included). */
export async function linkedMessageIds(
  db: ForumDiscordDb,
  discordThreadId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: links.discordMessageId })
    .from(links)
    .where(eq(links.discordThreadId, discordThreadId));
  return rows.map((r) => r.id);
}

/** A post was finally sent: its waiting replies move to the real post id. */
export async function rehomeReplies(
  db: ForumDiscordDb,
  threadId: number,
  discordThreadId: string,
): Promise<void> {
  await db
    .update(links)
    .set({ discordThreadId })
    .where(
      and(
        eq(links.threadId, threadId),
        eq(links.kind, 'reply'),
        eq(links.discordThreadId, unsentId('thread', threadId)),
      ),
    );
}

/**
 * D9 — the link belongs to the hub's CURRENT binding: the hub is bound and
 * the link is not older than `bound_at` (same rule as `dueLockChanges`). A
 * post from a previous binding (unbind, re-bind) is left alone.
 */
export async function isCurrentBindingLink(
  db: ForumDiscordDb,
  link: Pick<ForumLink, 'guildId' | 'createdAt'>,
): Promise<boolean> {
  const b = schema.hubForumDiscordBindings;
  const [binding] = await db
    .select({ boundAt: b.boundAt })
    .from(b)
    .where(eq(b.guildId, link.guildId))
    .limit(1);
  return !!binding && link.createdAt.getTime() >= binding.boundAt.getTime();
}
