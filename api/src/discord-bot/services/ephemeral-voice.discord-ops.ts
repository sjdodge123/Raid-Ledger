import { ChannelType } from 'discord.js';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { timedDiscordCall } from './scheduled-event.helpers';

type Guild = NonNullable<ReturnType<DiscordBotClientService['getGuild']>>;

/**
 * Centralized Discord channel CRUD for ephemeral voice channels (ROK-1352).
 * Mirrors `scheduled-event.discord-ops.ts` — all calls go through
 * `timedDiscordCall` so latency + timeouts are instrumented uniformly.
 */

/** Create a public voice channel under `parentId` (guild root when null). */
export async function createVoiceChannel(
  guild: Guild,
  opts: { name: string; parentId: string | null },
): Promise<string> {
  const channel = await timedDiscordCall('ephemeral.create', () =>
    guild.channels.create({
      name: opts.name,
      type: ChannelType.GuildVoice,
      parent: opts.parentId ?? undefined,
    }),
  );
  return channel.id;
}

/** Delete a voice channel. No-op (returns false) if it's already gone. */
export async function deleteVoiceChannel(
  guild: Guild,
  channelId: string,
): Promise<boolean> {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return false;
  await timedDiscordCall('ephemeral.delete', () =>
    guild.channels.delete(channelId),
  );
  return true;
}

/**
 * Current name of an ephemeral voice channel from the guild cache, or null when
 * it is not cached / gone. Used by the name-reconcile pass to compare against the
 * expected name so a rename only fires when they actually differ (channel
 * renames are rate-limited to ~2/10min — comparing first avoids churn).
 */
export function getEphemeralChannelName(
  guild: Guild,
  channelId: string,
): string | null {
  return guild.channels.cache.get(channelId)?.name ?? null;
}

/** Rename a voice channel (ephemeral name backfill). Instrumented + timed. */
export async function renameVoiceChannel(
  guild: Guild,
  channelId: string,
  name: string,
): Promise<void> {
  await timedDiscordCall('ephemeral.rename', () =>
    guild.channels.edit(channelId, { name }),
  );
}

/**
 * Reconcile an ephemeral event's Scheduled-Event name to `expectedName`, renaming
 * only when Discord's CURRENT name differs (no-churn: fires once after deploy,
 * then matches → skip). Reads the current name from the cache, falling back to a
 * single fetch on a cold cache; a missing/deleted SE is treated as a skip.
 * Returns true when a rename was issued. Caller wraps in try/catch.
 */
export async function reconcileScheduledEventName(
  guild: Guild,
  seId: string,
  expectedName: string,
): Promise<boolean> {
  const current =
    guild.scheduledEvents.cache.get(seId) ??
    (await timedDiscordCall('scheduledEvents.fetch', () =>
      guild.scheduledEvents.fetch(seId),
    ).catch(() => null));
  if (!current || current.name === expectedName) return false;
  await timedDiscordCall('scheduledEvents.edit', () =>
    guild.scheduledEvents.edit(seId, { name: expectedName }),
  );
  return true;
}

/**
 * Live member count for a voice channel. Returns 0 when the channel is gone.
 * Used as the never-delete-while-occupied re-check immediately before delete.
 */
export function getChannelMemberCount(guild: Guild, channelId: string): number {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isVoiceBased()) return 0;
  return channel.members.size;
}

/**
 * Like getChannelMemberCount but force-fetches the channel when it is not in
 * cache, so a cold cache (e.g. right after a reconnect) cannot report an
 * occupied channel as empty and trigger a wrongful delete. Used at the actual
 * delete gate (destroyForEvent). Returns 0 only when the channel is truly gone.
 * The residual voice-state hydration window is bounded by the caller's
 * isConnected() guard. ROK-1352 (review finding #3).
 */
export async function getChannelMemberCountFresh(
  guild: Guild,
  channelId: string,
): Promise<number> {
  let channel = guild.channels.cache.get(channelId);
  if (!channel) {
    channel =
      (await guild.channels.fetch(channelId).catch(() => null)) ?? undefined;
  }
  if (!channel || !channel.isVoiceBased()) return 0;
  return channel.members.size;
}
