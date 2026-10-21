/**
 * Discord channel ops for the game-channel lifecycle (ROK-1431, spec ROK-1428
 * D5/D6/D10/D14). Pure functions over an injected `Guild` — no Nest, no DB.
 * Every call goes through `timedDiscordCall('lifecycle.<op>', …)` and maps
 * 10003 → `ChannelGoneError`, 50013/50001 → `LifecyclePermissionError`.
 *
 * Archive/unarchive live in `channel-lifecycle.archive-ops.ts` (re-exported).
 */
import { Logger } from '@nestjs/common';
import { ChannelType, type Guild, type GuildBasedChannel } from 'discord.js';
import { listGuildCategories } from '../discord-bot-client.guild.helpers';
import {
  isDiscordCode,
  lifecycleCall,
  UNKNOWN_CHANNEL,
} from './channel-lifecycle.errors';

export {
  archiveChannel,
  revertArchive,
  unarchiveChannel,
  type ArchiveResult,
} from './channel-lifecycle.archive-ops';

/** Discord's channel-name and topic length caps. */
export const MAX_CHANNEL_NAME = 100;
export const MAX_CHANNEL_TOPIC = 1024;
/** Discord's cap on channels per category (D5 overflow trigger). */
export const MAX_CATEGORY_CHILDREN = 50;
/** Highest `<name> N` treated as overflow — "Archived 2024" is an admin's own category. */
export const MAX_OVERFLOW_N = 50;

/** A category resolved by `ensureCategory`. */
export interface EnsuredCategory {
  id: string;
  name: string;
  created: boolean;
}

const logger = new Logger('ChannelLifecycleOps');

/**
 * A create that lands after `lifecycleCall` already failed it (the timeout
 * won the race, Codex r7 P2): the run counted it failed and nothing will bind
 * or clean up the new id, so delete it. Best effort; never rejects.
 */
function deleteIfLate(guild: Guild, pending: Promise<{ id: string }>): void {
  pending
    .then(async (late) => {
      logger.warn(`Deleting channel ${late.id}: its create timed out`);
      await guild.channels.delete(late.id, 'Raid Ledger: create timed out');
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug(`Late-create cleanup skipped: ${msg}`);
    });
}

/**
 * Create a text channel (name ≤100, topic ≤1024); returns its id. If the call
 * fails while Discord's request is still in flight, a late success is deleted.
 */
export async function createTextChannel(
  guild: Guild,
  opts: { name: string; parentId: string | null; topic: string },
): Promise<string> {
  let pending: Promise<{ id: string }> | undefined;
  try {
    const channel = await lifecycleCall('create', null, () => {
      const p = guild.channels.create({
        name: opts.name.slice(0, MAX_CHANNEL_NAME),
        type: ChannelType.GuildText,
        ...(opts.parentId !== null ? { parent: opts.parentId } : {}),
        topic: opts.topic.slice(0, MAX_CHANNEL_TOPIC),
      });
      pending = p;
      return p;
    });
    return channel.id;
  } catch (err) {
    if (pending) deleteIfLate(guild, pending);
    throw err;
  }
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
 * Categories named `base` or `base N` (case-insensitive, 2 ≤ N ≤
 * {@link MAX_OVERFLOW_N}), ordered by N with the bare name as 1. Returns the
 * series and the highest N seen.
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
    const n = /^[1-9]\d*$/.test(suffix) ? Number(suffix) : 0;
    if (n >= 2 && n <= MAX_OVERFLOW_N) ranked.push({ cat, n });
  }
  ranked.sort((a, b) => a.n - b.n);
  const maxN = ranked.reduce((m, r) => Math.max(m, r.n), 0);
  return { series: ranked.map((r) => r.cat), maxN };
}

/**
 * True when `id` still resolves to a category below the 50-children limit
 * (unarchive's restore target — a full one would fail every move back).
 */
export async function categoryHasRoom(
  guild: Guild,
  id: string,
): Promise<boolean> {
  const cat = await categoryById(guild, id);
  return cat !== null && childCount(guild, cat.id) < MAX_CATEGORY_CHILDREN;
}

/** Ids of the `base` / `base N` category series (D5 overflow), e.g. Archived. */
export function categorySeriesIds(guild: Guild, base: string): Set<string> {
  return new Set(overflowSeries(guild, base).series.map((c) => c.id));
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
