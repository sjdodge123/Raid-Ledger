import { and, count, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { findLfgBoardBindingChannelId } from '../../../discord-bot/lfg-board/lfg-board-channel.db-helpers';

/** ROK-2208 — the Drizzle handle every binding read/write takes. */
export type ForumDiscordDb = PostgresJsDatabase<typeof schema>;

const forums = schema.hubForumDiscordForums;
const bindings = schema.hubForumDiscordBindings;

/** A hub's binding joined with its forum row. */
export interface BindingWithForum {
  binding: schema.HubForumDiscordBindingSelect;
  forum: schema.HubForumDiscordForumSelect;
}

/** The hub's live binding, or null while unlinked. */
export async function findBinding(
  db: ForumDiscordDb,
  guildId: number,
): Promise<BindingWithForum | null> {
  const [row] = await db
    .select({ binding: bindings, forum: forums })
    .from(bindings)
    .innerJoin(forums, eq(forums.id, bindings.forumId))
    .where(eq(bindings.guildId, guildId))
    .limit(1);
  return row ?? null;
}

/** Every hub bound to a forum, with the hub's name (tag naming). */
export async function listForumBindings(
  db: ForumDiscordDb,
  forumId: number,
): Promise<{ guildId: number; tagId: string | null; hubName: string }[]> {
  return db
    .select({
      guildId: bindings.guildId,
      tagId: bindings.tagId,
      hubName: schema.guilds.name,
    })
    .from(bindings)
    .innerJoin(schema.guilds, eq(schema.guilds.id, bindings.guildId))
    .where(eq(bindings.forumId, forumId));
}

/** The forum row for a channel, created (unmanaged) when missing. */
export async function upsertForum(
  db: ForumDiscordDb,
  row: { discordGuildId: string; channelId: string; managed: boolean },
): Promise<schema.HubForumDiscordForumSelect> {
  await db.insert(forums).values(row).onConflictDoNothing();
  const [found] = await db
    .select()
    .from(forums)
    .where(eq(forums.channelId, row.channelId))
    .limit(1);
  if (!found) throw new Error(`forum row for ${row.channelId} vanished`);
  return found;
}

/** Patch a forum row (webhook id, require-tag flag). */
export async function updateForum(
  db: ForumDiscordDb,
  forumId: number,
  patch: Partial<
    Pick<schema.HubForumDiscordForumInsert, 'webhookId' | 'requireTagSet'>
  >,
): Promise<void> {
  await db.update(forums).set(patch).where(eq(forums.id, forumId));
}

/** Insert the hub's binding (the ack + R8 cut-off). */
export async function insertBinding(
  db: ForumDiscordDb,
  row: schema.HubForumDiscordBindingInsert,
): Promise<void> {
  await db.insert(bindings).values(row);
}

/** Give an already-bound hub its forum tag (shared forum). */
export async function setBindingTag(
  db: ForumDiscordDb,
  guildId: number,
  tagId: string,
): Promise<void> {
  await db.update(bindings).set({ tagId }).where(eq(bindings.guildId, guildId));
}

/** Remove the hub's binding; links stay for history (D9). */
export async function deleteBinding(
  db: ForumDiscordDb,
  guildId: number,
): Promise<void> {
  await db.delete(bindings).where(eq(bindings.guildId, guildId));
}

/** Drop a forum row (only once no hub binds it). */
export async function deleteForumRow(
  db: ForumDiscordDb,
  forumId: number,
): Promise<void> {
  await db.delete(forums).where(eq(forums.id, forumId));
}

/** A channel's bound hubs, and how many of them still have no tag. */
export interface ChannelBindingCount {
  hubs: number;
  untagged: number;
}

/**
 * How many hubs bind each channel (and how many lack a tag — ROK-2258's tag
 * budget reserves a slot for each), keyed by Discord channel id.
 */
export async function bindingCountsByChannel(
  db: ForumDiscordDb,
): Promise<Map<string, ChannelBindingCount>> {
  const rows = await db
    .select({
      channelId: forums.channelId,
      hubs: count(bindings.guildId),
      untagged:
        sql<number>`count(*) filter (where ${bindings.tagId} is null)`.mapWith(
          Number,
        ),
    })
    .from(forums)
    .innerJoin(bindings, eq(bindings.forumId, forums.id))
    .groupBy(forums.channelId);
  return new Map(
    rows.map((r) => [r.channelId, { hubs: r.hubs, untagged: r.untagged }]),
  );
}

/** Channel ids of the forums the bot made in this Discord guild. */
export async function managedChannelIds(
  db: ForumDiscordDb,
  discordGuildId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ channelId: forums.channelId })
    .from(forums)
    .where(
      and(eq(forums.discordGuildId, discordGuildId), eq(forums.managed, true)),
    );
  return new Set(rows.map((r) => r.channelId));
}

/** The hub's display name (forum tag name). */
export async function hubName(
  db: ForumDiscordDb,
  guildId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ name: schema.guilds.name })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);
  return row?.name ?? null;
}

/**
 * Channels a hub forum may not take (§5.1 step 3): the LFG board binding and
 * every hub's mirror or media channel.
 */
export async function inUseChannelIds(
  db: ForumDiscordDb,
  discordGuildId: string,
): Promise<Set<string>> {
  const p = schema.guildProfiles;
  const profiles = await db
    .select({ mirror: p.discordChannelId, media: p.mediaChannelId })
    .from(p);
  const lfg = await findLfgBoardBindingChannelId(db, discordGuildId);
  const ids = [...profiles.flatMap((r) => [r.mirror, r.media]), lfg];
  return new Set(ids.filter((id): id is string => id !== null));
}

/** Discord thread ids of the hub's synced RL threads (tag on share). */
export async function linkedThreadIds(
  db: ForumDiscordDb,
  guildId: number,
): Promise<string[]> {
  const l = schema.hubForumDiscordLinks;
  const rows = await db
    .select({ id: l.discordThreadId })
    .from(l)
    .where(and(eq(l.guildId, guildId), eq(l.kind, 'thread')));
  return rows.map((r) => r.id);
}
