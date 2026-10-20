/**
 * ROK-1868 L2 — `hub_posts` reads/writes (no access logic). Every read joins
 * `users` twice (author + last editor) so the service maps with `toHubPost`.
 *
 * Keyset order is `(created_at DESC, id DESC)` on the RAW columns so
 * `idx_hub_posts_guild_created` serves both the ORDER BY and the row-compare
 * cursor. `now()`-stamped rows (the backfill) carry microseconds, which a JS
 * `Date` would round to ms — so the cursor carries `cursorAt`, the DB's own
 * full-precision UTC text, and the comparison stays exact.
 */
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { HubPostSelect } from '../../drizzle/schema/hub-posts';
import type { HubPostCursor, HubPostPeople } from './hub-posts.helpers';

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

/** Feed order on the indexed columns (newest first, id breaks ties). */
const feedOrder = [desc(hubPosts.createdAt), desc(hubPosts.id)] as const;

/** `created_at` as UTC ISO text with microseconds, for the next cursor. */
const cursorAt = sql<string>`to_char(${hubPosts.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

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

/** A selected row: the record plus its full-precision cursor timestamp. */
export interface JoinedRow extends HubPostRecord {
  cursorAt: string;
}

function selectRecords(db: Db, where: SQL | undefined) {
  return db
    .select({
      post: hubPosts,
      author: authorColumns,
      editor: editorColumns,
      cursorAt,
    })
    .from(hubPosts)
    .leftJoin(author, eq(author.id, hubPosts.authorId))
    .leftJoin(editor, eq(editor.id, hubPosts.updatedBy))
    .where(where)
    .orderBy(...feedOrder);
}

/** Drop the cursor-only column so callers see a plain record. */
function withoutCursor(row: JoinedRow): HubPostRecord {
  return { post: row.post, author: row.author, editor: row.editor };
}

/** Split a `limit + 1` probe into the page and the next cursor. */
export function pageOf(rows: readonly JoinedRow[], limit: number): HubPostPage {
  const kept = rows.slice(0, limit);
  const records = kept.map(withoutCursor);
  const last = kept[kept.length - 1];
  const next =
    rows.length > limit && last
      ? { createdAt: last.cursorAt, id: last.post.id }
      : null;
  return { records, next };
}

/** The `limit + 1` probe query behind `listPosts` (exported for SQL tests). */
export function listPostsQuery(
  db: Db,
  guildId: number,
  limit: number,
  cursor: HubPostCursor | null,
) {
  const after = cursor
    ? sql`(${hubPosts.createdAt}, ${hubPosts.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id})`
    : undefined;
  return selectRecords(db, and(eq(hubPosts.guildId, guildId), after)).limit(
    limit + 1,
  );
}

/** Newest-first page of a guild's posts after `cursor` (exclusive). */
export async function listPosts(
  db: Db,
  guildId: number,
  limit: number,
  cursor: HubPostCursor | null,
): Promise<HubPostPage> {
  const rows = await listPostsQuery(db, guildId, limit, cursor);
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
  return row && withoutCursor(row);
}

/** The guild's newest post, if any. */
export async function latestPost(
  db: Db,
  guildId: number,
): Promise<HubPostRecord | undefined> {
  const [row] = await selectRecords(db, eq(hubPosts.guildId, guildId)).limit(1);
  return row && withoutCursor(row);
}

/** `DISTINCT ON (guild_id)` newest-post query (exported for SQL tests). */
export function latestByGuildQuery(db: Db, guildIds: readonly number[]) {
  return db
    .selectDistinctOn([hubPosts.guildId])
    .from(hubPosts)
    .where(inArray(hubPosts.guildId, [...guildIds]))
    .orderBy(hubPosts.guildId, ...feedOrder);
}

/** guildId → newest post (`DISTINCT ON (guild_id)`), for list headlines. */
export async function latestPostsByGuild(
  db: Db,
  guildIds: readonly number[],
): Promise<Map<number, HubPostSelect>> {
  const out = new Map<number, HubPostSelect>();
  if (guildIds.length === 0) return out;
  const rows = await latestByGuildQuery(db, guildIds);
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

/**
 * Record where a post was relayed in Discord; false when the post no longer
 * exists (deleted while the send was in flight), so the caller can unrelay.
 */
export async function setRelay(
  db: Db,
  postId: number,
  relay: { channelId: string; messageId: string; at: Date },
): Promise<boolean> {
  const rows = await db
    .update(hubPosts)
    .set({
      relayChannelId: relay.channelId,
      relayMessageId: relay.messageId,
      relayedAt: relay.at,
    })
    .where(eq(hubPosts.id, postId))
    .returning({ id: hubPosts.id });
  return rows.length > 0;
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
