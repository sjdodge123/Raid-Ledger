/**
 * ROK-2208 §5.3–§5.5 — the inbound (Discord → RL) writes. Separate from
 * `hub-forum.writes` because Discord-origin rows may have no RL author
 * (guests, R2/R7), deletes/pins have no RL actor (`deleted_by`/`pinned_by`
 * null) and edits skip the 24 h window (R3). These writes never emit
 * `hub-forum.changed` (D2) — the first echo guard.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { ForumLink } from './hub-forum-discord-links.queries';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const { hubForumThreads: threads, hubForumReplies: replies } = schema;
const links = schema.hubForumDiscordLinks;
type Tx = Parameters<Parameters<ForumDiscordDb['transaction']>[0]>[0];

/** Who wrote a Discord-origin row: a linked RL user, or a guest. */
export interface DiscordAuthor {
  authorId: number | null;
  authorDiscordId: string;
  authorDiscordName: string;
  authorDiscordAvatar: string | null;
}

/** The Discord ids a new row is linked to. */
interface DiscordIds {
  discordThreadId: string;
  discordMessageId: string;
}

/** The link of a Discord message (any origin), if any. */
export async function findLinkByMessage(
  db: ForumDiscordDb,
  discordMessageId: string,
): Promise<ForumLink | null> {
  const [row] = await db
    .select()
    .from(links)
    .where(eq(links.discordMessageId, discordMessageId))
    .limit(1);
  return row ?? null;
}

/** The thread link of a Discord forum post, if any. */
export async function findPostLink(
  db: ForumDiscordDb,
  discordThreadId: string,
): Promise<ForumLink | null> {
  const [row] = await db
    .select()
    .from(links)
    .where(
      and(eq(links.discordThreadId, discordThreadId), eq(links.kind, 'thread')),
    )
    .limit(1);
  return row ?? null;
}

/** The RL user linked to a Discord account (R2), if any. */
export async function userIdForDiscord(
  db: ForumDiscordDb,
  discordId: string,
): Promise<number | null> {
  const u = schema.users;
  const [row] = await db
    .select({ id: u.id })
    .from(u)
    .where(eq(u.discordId, discordId))
    .limit(1);
  return row?.id ?? null;
}

function discordLink(
  row: { guildId: number; threadId: number; replyId: number | null },
  ids: DiscordIds,
  now: Date,
): schema.HubForumDiscordLinkInsert {
  return {
    ...row,
    ...ids,
    kind: row.replyId === null ? 'thread' : 'reply',
    origin: 'discord',
    syncState: 'synced',
    syncedAt: now,
  };
}

/** Import a forum post as an RL thread + its link, atomically. */
export async function insertDiscordThread(
  db: ForumDiscordDb,
  row: { guildId: number; title: string; body: string; now: Date },
  author: DiscordAuthor,
  ids: DiscordIds,
): Promise<number> {
  const { now, ...rest } = row;
  return db.transaction(async (tx) => {
    const [t] = await tx
      .insert(threads)
      .values({
        ...rest,
        ...author,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      })
      .returning({ id: threads.id });
    if (!t) throw new Error('hub_forum_threads insert returned no row');
    const link = { guildId: row.guildId, threadId: t.id, replyId: null };
    await tx.insert(links).values(discordLink(link, ids, now));
    return t.id;
  });
}

/** Count one more reply on a LIVE thread; false when it is gone. */
async function bumpLiveThread(
  tx: Tx,
  threadId: number,
  now: Date,
): Promise<boolean> {
  const bumped = await tx
    .update(threads)
    .set({
      replyCount: sql`${threads.replyCount} + 1`,
      lastActivityAt: sql`GREATEST(${threads.lastActivityAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(and(eq(threads.id, threadId), isNull(threads.deletedAt)))
    .returning({ id: threads.id });
  return bumped.length > 0;
}

/** Import a Discord message as a reply; null when the thread is not live. */
export async function insertDiscordReply(
  db: ForumDiscordDb,
  row: { guildId: number; threadId: number; body: string; now: Date },
  author: DiscordAuthor,
  ids: DiscordIds,
): Promise<number | null> {
  const { now, guildId, threadId, body } = row;
  return db.transaction(async (tx) => {
    if (!(await bumpLiveThread(tx, threadId, now))) return null;
    const [r] = await tx
      .insert(replies)
      .values({
        guildId,
        threadId,
        body,
        ...author,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: replies.id });
    if (!r) throw new Error('hub_forum_replies insert returned no row');
    await tx
      .insert(links)
      .values(discordLink({ guildId, threadId, replyId: r.id }, ids, now));
    return r.id;
  });
}

/** R3: a Discord edit lands at any time (no 24 h window); live rows only. */
export async function editFromDiscord(
  db: ForumDiscordDb,
  link: ForumLink,
  edit: { title?: string; body?: string; now: Date },
): Promise<void> {
  const stamp = { editedAt: edit.now, updatedAt: edit.now };
  if (link.replyId !== null) {
    if (edit.body === undefined) return;
    await db
      .update(replies)
      .set({ body: edit.body, ...stamp })
      .where(and(eq(replies.id, link.replyId), isNull(replies.deletedAt)));
    return;
  }
  await db
    .update(threads)
    .set({
      ...(edit.title !== undefined ? { title: edit.title } : {}),
      ...(edit.body !== undefined ? { body: edit.body } : {}),
      ...stamp,
    })
    .where(and(eq(threads.id, link.threadId), isNull(threads.deletedAt)));
}

/** The soft-delete stamp of a Discord-side removal (no RL actor). */
interface Gone {
  deletedAt: Date;
  deletedBy: null;
  deletedAs: 'author' | 'moderator';
  updatedAt: Date;
}

/** Soft-delete a live reply and drop it from its thread's count. */
async function removeReply(
  tx: Tx,
  link: ForumLink,
  replyId: number,
  gone: Gone,
): Promise<void> {
  const done = await tx
    .update(replies)
    .set(gone)
    .where(and(eq(replies.id, replyId), isNull(replies.deletedAt)))
    .returning({ id: replies.id });
  if (done.length === 0) return;
  await tx
    .update(threads)
    .set({ replyCount: sql`greatest(${threads.replyCount} - 1, 0)` })
    .where(eq(threads.id, link.threadId));
}

/**
 * §5.3: a Discord-side delete soft-deletes the RL row (`deleted_by` null)
 * and records the Discord side as gone. Already-deleted rows are untouched.
 */
export async function removeFromDiscord(
  db: ForumDiscordDb,
  link: ForumLink,
  as: 'author' | 'moderator',
  now: Date,
): Promise<void> {
  const gone: Gone = {
    deletedAt: now,
    deletedBy: null,
    deletedAs: as,
    updatedAt: now,
  };
  await db.transaction(async (tx) => {
    await tx
      .update(links)
      .set({ discordDeletedAt: now })
      .where(eq(links.id, link.id));
    if (link.replyId !== null) {
      await removeReply(tx, link, link.replyId, gone);
      return;
    }
    await tx
      .update(threads)
      .set({ ...gone, pinnedAt: null, pinnedBy: null })
      .where(and(eq(threads.id, link.threadId), isNull(threads.deletedAt)));
  });
}
