/**
 * ROK-1740: the join-post smoke's channel, reserved BEFORE the binding pool.
 *
 * The pool binds `min(games, non-default channels)` channels, and CI seeds
 * enough games to take every one — so "a channel outside the pool" chosen
 * afterwards may not exist. Instead the join-post channel is picked first,
 * deterministically, and the pool is built from what is left.
 */
import type { DiscordChannel } from "./types.js";

const GUILD_TEXT = 0;

/** The last non-default guild text channel; null when there is none. */
export function pickJoinPostChannel(
  textChannels: DiscordChannel[],
  defaultChannelId: string,
): DiscordChannel | null {
  const usable = textChannels.filter(
    (c) =>
      c.id !== defaultChannelId &&
      (c.type === undefined || c.type === GUILD_TEXT),
  );
  return usable[usable.length - 1] ?? null;
}

/** Channels the binding pool may use: not default, not the join-post one. */
export function poolCandidateChannels(
  textChannels: DiscordChannel[],
  defaultChannelId: string,
): DiscordChannel[] {
  const reserved = pickJoinPostChannel(textChannels, defaultChannelId);
  return textChannels.filter(
    (c) => c.id !== defaultChannelId && c.id !== reserved?.id,
  );
}
