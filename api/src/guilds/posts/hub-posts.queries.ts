/**
 * ROK-1868 L2 — `hub_posts` reads/writes (no access logic). Every read joins
 * `users` twice (author + last editor) so the service maps with `toHubPost`.
 *
 * Keyset order is `(created_at DESC, id DESC)` on the MILLISECOND-truncated
 * timestamp: the cursor carries a JS `Date` (ms), while `now()`-stamped rows
 * (the backfill) carry microseconds — comparing raw values would skip rows.
 */
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { HubPostSelect } from '../../drizzle/schema/hub-posts';
import type {
  HubPostCursor,
  HubPostPeople,
  HubPostPersonRow,
} from './hub-posts.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const { hubPosts, users } = schema;
const author = alias(users, 'hub_post_author');
const editor = alias(users, 'hub_post_editor');

/** One post with its author / editor (null once wiped). */
export interface HubPostRecord extends HubPostPeople {
  post: HubPostSelect;
}

/** One page of the feed; `next` is null on the last page. */
export interface HubPostPage {
  records: HubPostRecord[];
  next: HubPostCursor | null;
}

const createdMs = sql`date_trunc('milliseconds', ${hubPosts.createdAt})`;

const authorColumns = {
  userId: author.id,
  username: author.username,
  displayName: author.displayName,
  avatar: author.avatar,
  customAvatarUrl: author.customAvatarUrl,
  discordId: author.discordId,
};

const editorColumns = {
  userId: editor.id,
  username: editor.username,
  displayName: editor.displayName,
  avatar: editor.avatar,
  customAvatarUrl: editor.customAvatarUrl,
  discordId: editor.discordId,
};

interface JoinedRow {
  post: HubPostSelect;
  author: HubPostPersonRow | null;
  editor: HubPostPersonRow | null;
}

function selectRecords(db: Db, where: SQL | undefined) {
  return db
    .select({
      post: hubPosts,
      author: authorColumns,
      editor: editorColumns,
    })
    .from(hubPosts)
    .leftJoin(author, eq(author.id, hubPosts.authorId))
    .leftJoin(editor, eq(editor.id, hubPosts.updatedBy))
    .where(where)
    .orderBy(desc(createdMs), desc(hubPosts.id));
}

/** Split a `limit + 1` probe into the page and the next cursor. */
export function pageOf(rows: readonly JoinedRow[], limit: number): HubPostPage {
  const records = rows.slice(0, limit);
  const last = records[records.length - 1];
  const next =
    rows.length > limit && last
      ? { createdAt: last.post.createdAt, id: last.post.id }
      : null;
  return { records, next };
}

/** Newest-first page of a guild's posts after `cursor` (exclusive). */
export async function listPosts(
  db: Db,
  guildId: number,
  limit: number,
  cursor: HubPostCursor | null,
): Promise<HubPostPage> {
  const after = cursor
    ? sql`(${createdMs}, ${hubPosts.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id})`
    : undefined;
  const rows = await selectRecords(
    db,
    and(eq(hubPosts.guildId, guildId), after),
  ).limit(limit + 1);
  return pageOf(rows, limit);
}

/** One post, scoped to its guild (another guild's id → undefined). */
export async function findPost(
  db: Db,
  guildId: number,
  postId: number,
): Promise<HubPostRecord | undefined> {
  const [row] = await selectRecords(
    db,
    and(eq(hubPosts.guildId, guildId), eq(hubPosts.id, postId)),
  ).limit(1);
  return row;
}

/** The guild's newest post, if any. */
export async function latestPost(
  db: Db,
  guildId: number,
): Promise<HubPostRecord | undefined> {
  const [row] = await selectRecords(db, eq(hubPosts.guildId, guildId)).limit(1);
  return row;
}

/** guildId → newest post (`DISTINCT ON (guild_id)`), for list headlines. */
export async function latestPostsByGuild(
  db: Db,
  guildIds: readonly number[],
): Promise<Map<number, HubPostSelect>> {
  const out = new Map<number, HubPostSelect>();
  if (guildIds.length === 0) return out;
  const rows = await db
    .selectDistinctOn([hubPosts.guildId])
    .from(hubPosts)
    .where(inArray(hubPosts.guildId, [...guildIds]))
    .orderBy(hubPosts.guildId, desc(createdMs), desc(hubPosts.id));
  for (const row of rows) out.set(row.guildId, row);
  return out;
}

/** Insert a post; `now` stamps created_at = updated_at (ms precision). */
export async function insertPost(
  db: Db,
  values: { guildId: number; body: string; authorId: number; now: Date },
): Promise<HubPostSelect> {
  const { guildId, body, authorId, now } = values;
  const [row] = await db
    .insert(hubPosts)
    .values({ guildId, body, authorId, createdAt: now, updatedAt: now })
    .returning();
  if (!row)
    throw new Error(`hub_posts insert returned no row (guild ${guildId})`);
  return row;
}

/** Replace a post's body and stamp the editor; undefined when not found. */
export async function updatePostBody(
  db: Db,
  target: { guildId: number; postId: number },
  edit: { body: string; editorId: number; now: Date },
): Promise<HubPostSelect | undefined> {
  const [row] = await db
    .update(hubPosts)
    .set({ body: edit.body, updatedBy: edit.editorId, updatedAt: edit.now })
    .where(
      and(eq(hubPosts.guildId, target.guildId), eq(hubPosts.id, target.postId)),
    )
    .returning();
  return row;
}

/** Record where a post was relayed in Discord. */
export async function setRelay(
  db: Db,
  postId: number,
  relay: { channelId: string; messageId: string; at: Date },
): Promise<void> {
  await db
    .update(hubPosts)
    .set({
      relayChannelId: relay.channelId,
      relayMessageId: relay.messageId,
      relayedAt: relay.at,
    })
    .where(eq(hubPosts.id, postId));
}

/** Delete a post; returns its relay ids (both null if never relayed). */
export async function deletePost(
  db: Db,
  guildId: number,
  postId: number,
): Promise<
  { relayChannelId: string | null; relayMessageId: string | null } | undefined
> {
  const [row] = await db
    .delete(hubPosts)
    .where(and(eq(hubPosts.guildId, guildId), eq(hubPosts.id, postId)))
    .returning({
      relayChannelId: hubPosts.relayChannelId,
      relayMessageId: hubPosts.relayMessageId,
    });
  return row;
}
