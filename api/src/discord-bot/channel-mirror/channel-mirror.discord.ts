/**
 * ROK-1788 — the discord.js adapter for the channel mirror. Cache-only lookups
 * (no REST) except `fetchLatest` and the member fetch in `canMemberView`.
 */
import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type NewsChannel,
  type TextChannel,
} from 'discord.js';
import type { GuildDiscordChannelOptionDto } from '@raid-ledger/contract';
import { listGuildTextChannels } from '../discord-bot-client.guild.helpers';
import type { MirrorChannelPort } from './channel-mirror.read';

type MirrorTextChannel = TextChannel | NewsChannel;

const BOT_READ_FLAGS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
];

/** A text/announcement channel of the guild, or null. */
export function findTextChannel(
  guild: Guild,
  channelId: string,
): MirrorTextChannel | null {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return null;
  if (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement
  ) {
    return channel;
  }
  return null;
}

/** The bot itself has ViewChannel + ReadMessageHistory on the channel. */
export function botCanRead(guild: Guild, channel: MirrorTextChannel): boolean {
  const me = guild.members.me;
  if (!me) return false;
  return channel.permissionsFor(me).has(BOT_READ_FLAGS);
}

/** Private = `@everyone` cannot view the channel (D7). */
export function isPrivateChannel(
  guild: Guild,
  channel: MirrorTextChannel,
): boolean {
  return !channel
    .permissionsFor(guild.roles.everyone)
    .has(PermissionFlagsBits.ViewChannel);
}

/** The real port for {@link readChannelMirror}, or null when not mirrorable. */
export function toMirrorPort(
  guild: Guild,
  channelId: string,
): MirrorChannelPort | null {
  const channel = findTextChannel(guild, channelId);
  if (!channel) return null;
  return {
    id: channel.id,
    name: channel.name,
    botCanRead: () => botCanRead(guild, channel),
    isPrivate: () => isPrivateChannel(guild, channel),
    fetchLatest: async (limit) => [
      ...(await channel.messages.fetch({ limit })).values(),
    ],
  };
}

/** Every text/announcement channel the bot can read, tagged public/private (D8). */
export function listReadableChannels(
  guild: Guild,
): GuildDiscordChannelOptionDto[] {
  return listGuildTextChannels(guild).flatMap(({ id }) => {
    const channel = findTextChannel(guild, id);
    if (!channel || !botCanRead(guild, channel)) return [];
    const visibility = isPrivateChannel(guild, channel) ? 'private' : 'public';
    return [{ id, name: channel.name, visibility }];
  });
}

/**
 * Whether a Discord user (a guild member) can view the channel (D7). One
 * `members.fetch`; a non-member, or any fetch failure, is false.
 */
export async function canMemberView(
  guild: Guild,
  channel: MirrorTextChannel,
  discordUserId: string,
): Promise<boolean> {
  try {
    const member = await guild.members.fetch(discordUserId);
    return channel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel);
  } catch {
    return false;
  }
}
