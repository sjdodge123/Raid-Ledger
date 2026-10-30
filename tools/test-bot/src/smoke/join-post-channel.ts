/**
 * ROK-1740: the join-post smoke's channel, reserved BEFORE the binding pool.
 *
 * The pool binds `min(games, non-default channels)` channels, and CI seeds
 * enough games to take every one — so "a channel outside the pool" chosen
 * afterwards may not exist. Instead the join-post channel is picked first,
 * deterministically, and the pool is built from what is left.
 *
 * ROK-1788: two lease runs (`SMOKE_POOL_INDEX` 0 and 1) hold the guild at
 * once. With ONE reserved channel, every smoke that posts there (join-post,
 * mirror, hub-post-relay, valheim welcome, hub-media-ingest) shared it across
 * both runs, so one run's embed-only posts landed in the other run's mirror
 * window. The LAST TWO non-default text channels are now reserved and a run
 * picks between them by its pool index — no new channel, never `ci-*` /
 * `slot-*` (ROK-1623: `textChannels` is already the non-slot set).
 */
import { smokePoolIndex } from "./pool-index.js";
import type { DiscordChannel } from "./types.js";

const GUILD_TEXT = 0;
/** One reserved join-post channel per concurrent lease slot. */
const RESERVED_COUNT = 2;

/**
 * The reserved join-post channels, index-0 slot first: the last non-default
 * text channel, then the one before it. Fewer when the guild has fewer.
 */
export function reservedJoinPostChannels(
  textChannels: DiscordChannel[],
  defaultChannelId: string,
): DiscordChannel[] {
  const usable = textChannels.filter(
    (c) =>
      c.id !== defaultChannelId &&
      (c.type === undefined || c.type === GUILD_TEXT),
  );
  return usable.slice(-RESERVED_COUNT).reverse();
}

/**
 * This run's join-post channel: reserved slot `index % reserved.length`
 * (index 0 / unset → the last non-default text channel, as before ROK-1788).
 * A guild with one usable channel gives every index that channel; null when
 * there is none.
 */
export function pickJoinPostChannel(
  textChannels: DiscordChannel[],
  defaultChannelId: string,
  index: number = smokePoolIndex(),
): DiscordChannel | null {
  const reserved = reservedJoinPostChannels(textChannels, defaultChannelId);
  if (reserved.length === 0) return null;
  return reserved[index % reserved.length] ?? null;
}

/** Ids of the join-post channels reserved for OTHER lease slots. */
export function foreignJoinPostChannelIds(
  textChannels: DiscordChannel[],
  defaultChannelId: string,
  index: number = smokePoolIndex(),
): Set<string> {
  const own = pickJoinPostChannel(textChannels, defaultChannelId, index);
  const reserved = reservedJoinPostChannels(textChannels, defaultChannelId);
  return new Set(reserved.filter((c) => c.id !== own?.id).map((c) => c.id));
}

/** Channels the binding pool may use: not default, no reserved join-post one. */
export function poolCandidateChannels(
  textChannels: DiscordChannel[],
  defaultChannelId: string,
): DiscordChannel[] {
  const reserved = new Set(
    reservedJoinPostChannels(textChannels, defaultChannelId).map((c) => c.id),
  );
  return textChannels.filter(
    (c) => c.id !== defaultChannelId && !reserved.has(c.id),
  );
}
