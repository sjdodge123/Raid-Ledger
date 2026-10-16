import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  SetGuildDiscordChannelSchema,
  type GuildDiscordChannelListDto,
  type GuildDiscordChannelOptionDto,
  type SetGuildDiscordChannelDto,
} from '@raid-ledger/contract';

/** ROK-1788 — pure validation for the guild's Discord channel binding. */

export const UNREADABLE_CHANNEL_MESSAGE = "Raid Ledger can't read that channel";
export const PRIVATE_ACK_MESSAGE =
  'Confirm that every member who can open this guild page will see this private channel';
export const LINK_DISCORD_MESSAGE =
  'Link your Discord account to choose a private channel';
export const CHOOSER_CANNOT_VIEW_MESSAGE =
  "Your Discord account can't see that channel";
export const BOT_DISCONNECTED_MESSAGE = "Discord isn't connected right now";

const SNOWFLAKE = /^\d{17,20}$/;

/** Parse the PUT body; anything off-schema is a 400. */
export function parseSetChannel(body: unknown): SetGuildDiscordChannelDto {
  const parsed = SetGuildDiscordChannelSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

/**
 * The requested channel among the bot-readable ones (D8). Bot down is a 409
 * (the picker is disabled then); a channel the bot cannot read is a 400.
 */
export function pickReadableChannel(
  list: GuildDiscordChannelListDto,
  channelId: string,
): GuildDiscordChannelOptionDto {
  if (!list.connected) throw new ConflictException(BOT_DISCONNECTED_MESSAGE);
  const found = list.channels.find((channel) => channel.id === channelId);
  if (!found) throw new BadRequestException(UNREADABLE_CHANNEL_MESSAGE);
  return found;
}

/** A private choice needs the explicit acknowledgement (D7). */
export function assertPrivateAck(privateAck: boolean | undefined): void {
  if (privateAck !== true) throw new BadRequestException(PRIVATE_ACK_MESSAGE);
}

/**
 * The user's real Discord snowflake, or null for local-only / unlinked
 * placeholders (`local:<email>`, `unlinked:…`) and missing ids.
 */
export function linkedDiscordId(discordId: string | null): string | null {
  return discordId !== null && SNOWFLAKE.test(discordId) ? discordId : null;
}

/** 404 unless the guild exists. */
export function assertFound(found: unknown): void {
  if (!found) throw new NotFoundException('Guild not found');
}
