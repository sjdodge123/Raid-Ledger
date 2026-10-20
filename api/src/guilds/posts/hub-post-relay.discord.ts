import { DiscordAPIError, PermissionFlagsBits, type Guild } from 'discord.js';
import type { HubPostRelayChannel } from '@raid-ledger/contract';
import { findTextChannel } from '../../discord-bot/channel-mirror/channel-mirror.discord';

/** D8: what the bot needs in the bound channel to relay a post. */
const RELAY_FLAGS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

/**
 * Discord codes that are configuration, not bugs: Missing Access (50001),
 * Missing Permissions (50013), Unknown Channel (10003), Unknown Message
 * (10008). They warn; anything else also goes to Sentry.
 */
const EXPECTED_CODES = new Set([50001, 50013, 10003, 10008]);

/**
 * D8 from the bot's guild cache (no REST): the bound channel is `gone` when it
 * is missing or not a text/announcement channel, `no-permission` when the bot
 * lacks any of View Channel / Send Messages / Embed Links, else `ok`.
 */
export function relayChannelState(
  guild: Guild,
  channelId: string,
): HubPostRelayChannel {
  const channel = findTextChannel(guild, channelId);
  if (!channel) return { state: 'gone', channelId };
  const me = guild.members.me;
  const canSend = me ? channel.permissionsFor(me).has(RELAY_FLAGS) : false;
  if (!canSend) {
    return { state: 'no-permission', channelId, channelName: channel.name };
  }
  return { state: 'ok', channelId, channelName: channel.name };
}

/** True when a Discord failure is an expected configuration state (warn only). */
export function isExpectedRelayError(err: unknown): boolean {
  return err instanceof DiscordAPIError && EXPECTED_CODES.has(Number(err.code));
}
