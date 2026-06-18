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
 * Live member count for a voice channel. Returns 0 when the channel is gone.
 * Used as the never-delete-while-occupied re-check immediately before delete.
 */
export function getChannelMemberCount(guild: Guild, channelId: string): number {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isVoiceBased()) return 0;
  return channel.members.size;
}
