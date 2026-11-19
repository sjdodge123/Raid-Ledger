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
  type ChannelBindingCount,
  inUseChannelIds,
  managedChannelIds,
  type ForumDiscordDb,
} from './hub-forum-discord.queries';

/**
 * Free tag slots for one more hub: each bound hub still without a tag needs
 * one before the joiner gets its own, so those are reserved (0 = the forum
 * cannot take a hub — the bind's 409 `FORUM_DISCORD_TAG_LIMIT` agrees).
 * ROK-2258: a lone hub tagged at bind reserves nothing more; the Event tag
 * is best-effort (skipped when full), so it is never reserved.
 *
 * @param tagCount - Tags on the forum now.
 * @param untaggedHubs - Bound hubs with no tag yet.
 */
export function freeSlots(tagCount: number, untaggedHubs: number): number {
  return tagsFree(tagCount + untaggedHubs);
}

const NO_HUBS: ChannelBindingCount = { hubs: 0, untagged: 0 };

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
      const n = counts.get(f.id) ?? NO_HUBS;
      return {
        id: f.id,
        name: f.name,
        sharedWith: n.hubs,
        tagsFree: freeSlots(f.tags.length, n.untagged),
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

async function sharedCount(
  db: ForumDiscordDb,
  id: string,
): Promise<ChannelBindingCount> {
  return (await bindingCountsByChannel(db)).get(id) ?? NO_HUBS;
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
  n: ChannelBindingCount,
  hub: string,
): HubForumDiscordSharedOption {
  const sharedWith = n.hubs;
  const needsManage = sharedWith > 0 && !f.canManage;
  return {
    channelId: f.id,
    name: f.name,
    sharedWith,
    tagsUsed: f.tags.length,
    tagsFree: freeSlots(f.tags.length, n.untagged),
    tagName: sharedWith > 0 ? tagNameFor(hub) : null,
    missingPermissions: needsManage
      ? [...f.missing, MANAGE_CHANNELS.label]
      : f.missing,
  };
}
