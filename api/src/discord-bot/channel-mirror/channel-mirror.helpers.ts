/**
 * ROK-1788 — the pure half of the guild channel mirror: a Discord message in,
 * a wire DTO out; a Discord error in, a card state out. No client, no clock.
 *
 * Inputs are typed STRUCTURALLY (like the ROK-1483 helpers this reuses) so the
 * unit specs build two-line literals instead of discord.js `Message` objects.
 */
import { DiscordAPIError, MessageType } from 'discord.js';
import type {
  GuildDiscordEmbedDto,
  GuildDiscordMessageDto,
} from '@raid-ledger/contract';
import {
  toMirrorRow,
  toThreadMessageDto,
  type MirrorSourceMessage,
} from '../thread-mirror/thread-mirror.helpers';

/** How many messages one Discord read asks for (D10: headroom after filtering). */
export const CHANNEL_MIRROR_FETCH_LIMIT = 10;
/** Server-side cache lifetime of one channel read, failures included (D1/D5). */
export const CHANNEL_MIRROR_TTL_MS = 60_000;
/** Cap on message content and embed text sent to the page (D10). */
export const CHANNEL_MIRROR_TEXT_CAP = 2000;

/** Discord error codes that mean the bot cannot read the channel. */
const NO_ACCESS_CODES = new Set<number | string>([50001, 50013]);
/** Discord "Unknown Channel". */
const UNKNOWN_CHANNEL = 10003;

/** The embed fields the mirror reads (discord.js `Embed` getters). */
export interface ChannelMirrorSourceEmbed {
  title: string | null;
  description: string | null;
}

/** The structural slice of a discord.js `Message` the channel mirror needs. */
export interface ChannelMirrorSourceMessage extends MirrorSourceMessage {
  type: MessageType;
  system: boolean;
  embeds: readonly ChannelMirrorSourceEmbed[];
}

/** What a failed Discord read degrades to inside the card. */
export type ChannelMirrorFailure = 'no-access' | 'gone' | 'disconnected';

/**
 * Keep user posts and replies, bot posts included (Q8); drop Discord system
 * messages (joins, pins, boosts, thread-created...).
 */
export function isMirrorableMessage(
  message: Pick<ChannelMirrorSourceMessage, 'type' | 'system'>,
): boolean {
  if (message.system) return false;
  return (
    message.type === MessageType.Default || message.type === MessageType.Reply
  );
}

/** Trim text to {@link CHANNEL_MIRROR_TEXT_CAP} characters. */
export function capText(text: string): string {
  return text.length > CHANNEL_MIRROR_TEXT_CAP
    ? text.slice(0, CHANNEL_MIRROR_TEXT_CAP)
    : text;
}

/** The first embed's text, or null when it has neither title nor description. */
export function toEmbed(
  embeds: readonly ChannelMirrorSourceEmbed[],
): GuildDiscordEmbedDto | null {
  const first = embeds[0];
  if (!first) return null;
  const title = first.title ? capText(first.title) : null;
  const description = first.description ? capText(first.description) : null;
  if (title === null && description === null) return null;
  return { title, description };
}

/**
 * A live message as the wire DTO, through the SAME `toMirrorRow` +
 * `toThreadMessageDto` pipeline the thread mirror uses — nothing is stored.
 */
export function toGuildDiscordMessage(
  message: ChannelMirrorSourceMessage,
  discordGuildId: string,
): GuildDiscordMessageDto {
  const row = toMirrorRow(message, discordGuildId);
  const dto = toThreadMessageDto({
    messageId: row.messageId,
    authorDiscordId: row.authorDiscordId,
    authorDisplayName: row.authorDisplayName,
    authorAvatarHash: row.authorAvatarHash ?? null,
    content: capText(row.content ?? ''),
    attachments: row.attachments ?? [],
    mentions: row.mentions ?? [],
    reactions: row.reactions ?? [],
    discordCreatedAt: row.discordCreatedAt,
    editedAt: row.editedAt ?? null,
  });
  return { ...dto, embed: toEmbed(message.embeds) };
}

/** True when a DTO has nothing to render (no text, attachment or embed). */
function isBlank(message: GuildDiscordMessageDto): boolean {
  return (
    message.content.trim() === '' &&
    message.attachments.length === 0 &&
    message.embed === null
  );
}

/**
 * Filter, order oldest-first (by snowflake, exact as bigint) and map a fetched
 * batch. Discord returns newest-first; the card renders oldest-first.
 */
export function toGuildDiscordMessages(
  messages: readonly ChannelMirrorSourceMessage[],
  discordGuildId: string,
): GuildDiscordMessageDto[] {
  return messages
    .filter(isMirrorableMessage)
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
    .map((message) => toGuildDiscordMessage(message, discordGuildId))
    .filter((message) => !isBlank(message));
}

/**
 * Classify anything a Discord read threw. Missing Access / Missing
 * Permissions -> `no-access`; Unknown Channel -> `gone`; anything else
 * (network, 5xx, rate limit) is treated as transient -> `disconnected`.
 */
export function classifyMirrorError(error: unknown): ChannelMirrorFailure {
  if (!(error instanceof DiscordAPIError)) return 'disconnected';
  if (NO_ACCESS_CODES.has(error.code)) return 'no-access';
  if (error.code === UNKNOWN_CHANNEL) return 'gone';
  return 'disconnected';
}

/** The Open-in-Discord link (D12), a sibling of `buildThreadUrl`. */
export function buildChannelUrl(
  discordGuildId: string,
  channelId: string,
): string {
  return `https://discord.com/channels/${discordGuildId}/${channelId}`;
}
