import { HttpException } from '@nestjs/common';
import {
  HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME as SHARED_NAME,
  HUB_FORUM_DISCORD_TAG_LIMIT,
  type HubForumDiscordChannelOptions,
  type HubForumDiscordPreflight,
  type HubForumDiscordSharedOption,
} from '@raid-ledger/contract';
import type {
  ForumInfo,
  HubForumDiscordGateway,
} from './hub-forum-discord.gateway';
import {
  forumChannelName,
  MANAGE_CHANNELS,
  tagNameFor,
  tagsFree,
} from './hub-forum-discord.helpers';
import {
  bindingCountsByChannel,
  hubName,
  inUseChannelIds,
  managedChannelIds,
  type ForumDiscordDb,
} from './hub-forum-discord.queries';

/**
 * Free tag slots once one more hub joins: a forum serving one hub also needs
 * that hub's tag, so it is reserved too (0 = the forum cannot take a hub).
 */
export function freeSlots(tagCount: number, sharedWith: number): number {
  return tagsFree(tagCount + (sharedWith === 1 ? 1 : 0));
}

/**
 * The default name of the hub's own new forum (Q10 c). A hub whose name
 * slugs to the shared name falls back to `hub-forum`.
 */
export function suggestedForumName(name: string): string {
  try {
    return forumChannelName(name);
  } catch (err) {
    if (err instanceof HttpException) return 'hub-forum';
    throw err;
  }
}

/**
 * The shared `#hub-forums` on Discord: the bot-made one first, else any forum
 * by that name — so binding "shared" never makes a second one.
 */
export async function findSharedForum(
  db: ForumDiscordDb,
  gateway: HubForumDiscordGateway,
  discordGuildId: string,
): Promise<ForumInfo | null> {
  const named = gateway.listForums().filter((f) => f.name === SHARED_NAME);
  if (named.length < 2) return named[0] ?? null;
  const managed = await managedChannelIds(db, discordGuildId);
  return named.find((f) => managed.has(f.id)) ?? named[0] ?? null;
}

/**
 * `GET channels` — public forums the hub may bind (MAJOR-4: a forum
 * @everyone cannot see is never offered), each with its free tag slots and
 * the permissions the bot lacks there.
 */
export async function channelOptions(
  db: ForumDiscordDb,
  gateway: HubForumDiscordGateway,
  discordGuildId: string,
): Promise<HubForumDiscordChannelOptions> {
  const [inUse, counts] = await Promise.all([
    inUseChannelIds(db, discordGuildId),
    bindingCountsByChannel(db),
  ]);
  const channels = gateway
    .listForums()
    .filter((f) => f.isPublic && !inUse.has(f.id))
    .map((f) => {
      const sharedWith = counts.get(f.id) ?? 0;
      return {
        id: f.id,
        name: f.name,
        sharedWith,
        tagsFree: freeSlots(f.tags.length, sharedWith),
        missingPermissions: f.missing,
      };
    });
  return { channels };
}

/**
 * `GET preflight` — what the unbound form shows before "Turn on sync" (web
 * review MAJOR 2): bot online, create permissions, the shared option.
 */
export async function preflight(
  db: ForumDiscordDb,
  gateway: HubForumDiscordGateway,
  guildId: number,
): Promise<HubForumDiscordPreflight> {
  const hub = (await hubName(db, guildId)) ?? 'Hub';
  const suggestedName = suggestedForumName(hub);
  const discordGuildId = gateway.guildId();
  if (discordGuildId === null) {
    return {
      botOnline: false,
      missingToCreate: [],
      suggestedName,
      shared: null,
    };
  }
  const missingToCreate = gateway.missingToCreate();
  const forum = await findSharedForum(db, gateway, discordGuildId);
  const shared = forum
    ? sharedOption(forum, await sharedCount(db, forum.id), hub)
    : unmadeShared(missingToCreate);
  return { botOnline: true, missingToCreate, suggestedName, shared };
}

async function sharedCount(db: ForumDiscordDb, id: string): Promise<number> {
  return (await bindingCountsByChannel(db)).get(id) ?? 0;
}

/** The shared option before the bot has made `#hub-forums`. */
function unmadeShared(missing: string[]): HubForumDiscordSharedOption {
  return {
    channelId: null,
    name: SHARED_NAME,
    sharedWith: 0,
    tagsUsed: 0,
    tagsFree: HUB_FORUM_DISCORD_TAG_LIMIT,
    tagName: null,
    missingPermissions: missing,
  };
}

/** The live `#hub-forums`; tag edits (2nd hub on) need Manage Channels. */
function sharedOption(
  f: ForumInfo,
  sharedWith: number,
  hub: string,
): HubForumDiscordSharedOption {
  const needsManage = sharedWith > 0 && !f.canManage;
  return {
    channelId: f.id,
    name: f.name,
    sharedWith,
    tagsUsed: f.tags.length,
    tagsFree: freeSlots(f.tags.length, sharedWith),
    tagName: sharedWith > 0 ? tagNameFor(hub) : null,
    missingPermissions: needsManage
      ? [...f.missing, MANAGE_CHANNELS.label]
      : f.missing,
  };
}
