/**
 * ROK-2208 D3 — the link row IS the outbox: `origin='raidledger' AND
 * sync_state <> 'synced'` is the retry queue the S6 sweep drains.
 *
 * A create is claimed BEFORE Discord answers (so a crash or a failure leaves
 * a retryable row), but `discord_message_id` is NOT NULL UNIQUE — so an
 * unsent row carries a placeholder id `rl:<t|r>:<rl id>` (no schema change),
 * replaced by the real snowflake on success. `isUnsent` tells them apart.
 */
import { and, eq, sql } from 'drizzle-orm';
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
    .set({ syncState: 'synced', lastError: null, syncedAt: now })
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
    .set({ syncState: 'synced', lastError: null, discordDeletedAt: now })
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
