/**
 * ROK-1740: resolve the join post's target channel and preflight it (D4).
 *
 * Throws Nest exceptions so the controller stays thin:
 * 503 bot offline · 400 not a text channel · 422 missing permissions.
 */
import {
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ChannelType,
  type Guild,
  type NewsChannel,
  type TextChannel,
} from 'discord.js';
import type { DiscordJoinPostMissingPermissions } from '@raid-ledger/contract';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { missingJoinPostPermissions } from './join-post-permissions.helpers';

/** A guild channel the bot can post a plain message in. */
export type JoinPostTextChannel = TextChannel | NewsChannel;

/** The connected guild and the bot's own user id. */
export interface JoinPostBotContext {
  guild: Guild;
  botUserId: string;
}

export const BOT_OFFLINE_MESSAGE =
  'The Discord bot is offline — connect it on the Connection page and try again.';

/**
 * The live guild + bot identity, or 503 when the bot is not connected.
 *
 * @param client - Discord client wrapper.
 */
export function requireBotContext(
  client: DiscordBotClientService,
): JoinPostBotContext {
  const guild = client.isConnected() ? client.getGuild() : null;
  const bot = client.getBotUser();
  if (!guild || !bot)
    throw new ServiceUnavailableException(BOT_OFFLINE_MESSAGE);
  return { guild, botUserId: bot.id };
}

/**
 * A text/announcement channel from the guild cache, or null.
 *
 * @param guild - The connected guild.
 * @param channelId - Channel to look up.
 */
export function findTextChannel(
  guild: Guild,
  channelId: string,
): JoinPostTextChannel | null {
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

/**
 * Resolve the target channel and check the bot may post + pin there.
 *
 * @throws BadRequestException when the id is not a text channel in the guild.
 * @throws UnprocessableEntityException `{ message, missing }` on missing perms.
 */
export function resolvePostableChannel(
  ctx: JoinPostBotContext,
  channelId: string,
): JoinPostTextChannel {
  const channel = findTextChannel(ctx.guild, channelId);
  if (!channel) {
    throw new BadRequestException(
      'Pick a text channel in the connected Discord server.',
    );
  }
  const me = ctx.guild.members.me;
  const missing = missingJoinPostPermissions(
    me ? channel.permissionsFor(me) : null,
  );
  if (missing.length > 0) {
    const body: DiscordJoinPostMissingPermissions = {
      message: `The bot can't post in #${channel.name}. Missing: ${missing.join(', ')}.`,
      missing,
    };
    throw new UnprocessableEntityException(body);
  }
  return channel;
}
