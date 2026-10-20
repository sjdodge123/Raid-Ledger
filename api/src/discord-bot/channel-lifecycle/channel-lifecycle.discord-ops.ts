/**
 * Discord channel ops for the game-channel lifecycle (ROK-1431, spec ROK-1428
 * D5/D6/D10/D14). Pure functions over an injected `Guild` — no Nest, no DB.
 * Every call goes through `timedDiscordCall('lifecycle.<op>', …)` and maps
 * 10003 → `ChannelGoneError`, 50013/50001 → `LifecyclePermissionError`.
 *
 * Archive/unarchive are exact inverses for the overwrites they own: archive
 * denies `@everyone` SendMessages (+ ViewChannel when hidden, with a bot
 * ViewChannel allow so the bot can still manage it); unarchive clears exactly
 * those bits and deletes an overwrite left empty — it never writes an Allow.
 */
import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type Guild,
  type GuildBasedChannel,
  type PermissionOverwriteManager,
  type PermissionOverwriteOptions,
} from 'discord.js';
import { listGuildCategories } from '../discord-bot-client.guild.helpers';
import {
  isDiscordCode,
  lifecycleCall,
  resolveTextChannel,
  UNKNOWN_CHANNEL,
} from './channel-lifecycle.errors';

/** Discord's channel-name and topic length caps. */
export const MAX_CHANNEL_NAME = 100;
export const MAX_CHANNEL_TOPIC = 1024;
/** Discord's cap on channels per category (D5 overflow trigger). */
export const MAX_CATEGORY_CHILDREN = 50;

type FlagName = keyof typeof PermissionFlagsBits;

/** A category resolved by `ensureCategory`. */
export interface EnsuredCategory {
  id: string;
  name: string;
  created: boolean;
}

/** Create a text channel (name ≤100, topic ≤1024); returns its id. */
export async function createTextChannel(
  guild: Guild,
  opts: { name: string; parentId: string | null; topic: string },
): Promise<string> {
  const channel = await lifecycleCall('create', null, () =>
    guild.channels.create({
      name: opts.name.slice(0, MAX_CHANNEL_NAME),
      type: ChannelType.GuildText,
      ...(opts.parentId !== null ? { parent: opts.parentId } : {}),
      topic: opts.topic.slice(0, MAX_CHANNEL_TOPIC),
    }),
  );
  return channel.id;
}

/** Set a managed channel's topic (≤1024 chars). */
export async function setTopic(
  guild: Guild,
  channelId: string,
  topic: string,
): Promise<void> {
  await lifecycleCall('topic', channelId, () =>
    guild.channels.edit(channelId, {
      topic: topic.slice(0, MAX_CHANNEL_TOPIC),
    }),
  );
}

/** Move a channel without syncing its overwrites to the new parent. */
async function moveChannel(
  guild: Guild,
  op: string,
  channelId: string,
  parentId: string | null,
): Promise<void> {
  await lifecycleCall(op, channelId, () =>
    guild.channels.edit(channelId, {
      parent: parentId,
      lockPermissions: false,
    }),
  );
}

/**
 * Archive (D6): deny `@everyone` SendMessages (+ ViewChannel when `hide`,
 * granting the bot ViewChannel so it keeps access), then move the channel
 * under `categoryId`. Returns the parent it had, for `restore_parent_id`.
 */
export async function archiveChannel(
  guild: Guild,
  channelId: string,
  opts: { categoryId: string; hide: boolean },
): Promise<{ previousParentId: string | null }> {
  const channel = await resolveTextChannel(guild, channelId);
  const previousParentId = channel.parentId;
  const po = channel.permissionOverwrites;
  await lifecycleCall('archive.lock', channelId, async () => {
    if (opts.hide) {
      await po.edit(
        guild.client.user.id,
        { ViewChannel: true },
        { type: OverwriteType.Member },
      );
    }
    await po.edit(
      guild.id,
      { SendMessages: false, ...(opts.hide ? { ViewChannel: false } : {}) },
      { type: OverwriteType.Role },
    );
  });
  await moveChannel(guild, 'archive.move', channelId, opts.categoryId);
  return { previousParentId };
}

/**
 * Clear `flags` from one overwrite: delete it when nothing else is left on it,
 * otherwise reset just those bits to inherit (`null`). Never writes an Allow.
 */
async function clearFlags(
  po: PermissionOverwriteManager,
  id: string,
  flags: FlagName[],
  type: OverwriteType,
): Promise<void> {
  const ow = po.cache.get(id);
  if (!ow) return;
  const mask = flags.reduce((acc, f) => acc | PermissionFlagsBits[f], 0n);
  const rest = (ow.allow.bitfield | ow.deny.bitfield) & ~mask;
  if (rest === 0n) {
    await po.delete(id);
    return;
  }
  const reset: PermissionOverwriteOptions = {};
  for (const f of flags) reset[f] = null;
  await po.edit(id, reset, { type });
}

/**
 * Unarchive (D6): move the channel back to `parentId`, then remove exactly the
 * bits archive added — `@everyone` SendMessages/ViewChannel deny and the bot's
 * ViewChannel allow — deleting overwrites that end up empty.
 */
export async function unarchiveChannel(
  guild: Guild,
  channelId: string,
  opts: { parentId: string | null },
): Promise<void> {
  const channel = await resolveTextChannel(guild, channelId);
  await moveChannel(guild, 'unarchive.move', channelId, opts.parentId);
  const po = channel.permissionOverwrites;
  await lifecycleCall('unarchive.unlock', channelId, async () => {
    await clearFlags(
      po,
      guild.id,
      ['SendMessages', 'ViewChannel'],
      OverwriteType.Role,
    );
    await clearFlags(
      po,
      guild.client.user.id,
      ['ViewChannel'],
      OverwriteType.Member,
    );
  });
}

/** Number of channels currently parented to `categoryId` (guild cache). */
function childCount(guild: Guild, categoryId: string): number {
  return guild.channels.cache.filter((ch) => ch.parentId === categoryId).size;
}

/** Cache-then-fetch a category by id; unknown or non-category → null. */
async function categoryById(
  guild: Guild,
  id: string,
): Promise<{ id: string; name: string } | null> {
  let ch: GuildBasedChannel | null | undefined = guild.channels.cache.get(id);
  try {
    ch ??= await lifecycleCall('category.fetch', null, () =>
      guild.channels.fetch(id),
    );
  } catch (err) {
    if (!isDiscordCode(err, UNKNOWN_CHANNEL)) throw err;
    return null;
  }
  return ch?.type === ChannelType.GuildCategory
    ? { id: ch.id, name: ch.name }
    : null;
}

/**
 * Categories named `base` or `base N` (case-insensitive), ordered by N with
 * the bare name as 1. Returns the series and the highest N seen.
 */
function overflowSeries(
  guild: Guild,
  base: string,
): { series: { id: string; name: string }[]; maxN: number } {
  const want = base.trim().toLowerCase();
  const ranked: { cat: { id: string; name: string }; n: number }[] = [];
  for (const cat of listGuildCategories(guild)) {
    const name = cat.name.trim().toLowerCase();
    if (name === want) ranked.push({ cat, n: 1 });
    const suffix = name.startsWith(`${want} `)
      ? name.slice(want.length + 1)
      : '';
    if (/^[1-9]\d*$/.test(suffix)) ranked.push({ cat, n: Number(suffix) });
  }
  ranked.sort((a, b) => a.n - b.n);
  const maxN = ranked.reduce((m, r) => Math.max(m, r.n), 0);
  return { series: ranked.map((r) => r.cat), maxN };
}

/** Create a category; returns it as an `EnsuredCategory`. */
async function createCategory(
  guild: Guild,
  name: string,
): Promise<EnsuredCategory> {
  const cat = await lifecycleCall('category.create', null, () =>
    guild.channels.create({ name, type: ChannelType.GuildCategory }),
  );
  return { id: cat.id, name, created: true };
}

/**
 * Resolve a category (D5): the configured `id` → else the first category named
 * `name` (case-insensitive) → else create it. With `needsRoom`, a full
 * category (50 children) overflows to the first of `<name> 2`, `<name> 3`…
 * with room, creating the next number when every one is full.
 */
export async function ensureCategory(
  guild: Guild,
  opts: { id: string | null; name: string; needsRoom: boolean },
): Promise<EnsuredCategory> {
  const byId = opts.id !== null ? await categoryById(guild, opts.id) : null;
  const hasRoom = (c: { id: string }): boolean =>
    !opts.needsRoom || childCount(guild, c.id) < MAX_CATEGORY_CHILDREN;
  if (byId && hasRoom(byId)) return { ...byId, created: false };
  const base = byId?.name ?? opts.name;
  const { series, maxN } = overflowSeries(guild, base);
  const pick = series.find((c) => c.id !== byId?.id && hasRoom(c));
  if (pick) return { ...pick, created: false };
  return createCategory(guild, maxN === 0 ? base : `${base} ${maxN + 1}`);
}
