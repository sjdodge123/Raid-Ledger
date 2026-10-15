/**
 * ROK-1740: reading, finding and pinning the join post (D5, D6).
 *
 * Discord-free structural types, modelled on `lfg-composer-pin.helpers.ts`:
 * the fakes in the spec are the whole contract.
 *
 * - `readStored` answers null ONLY for Discord's Unknown Message (10008). Any
 *   other failure is rethrown — a transient fault must never look like "gone",
 *   or a re-post would duplicate the message (AC2).
 * - `findOwnJoinPost` rediscovers the bot's own post when no id is stored.
 * - `tryPin` warns, never throws (story: "warn, don't fail").
 */
import type { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import type { ChannelEmbed } from '../embeds/embed-chrome.helpers';
import { isUnknownMessage } from '../discord-bot-client.messages.helpers';
import {
  JOIN_POST_AUTHOR,
  JOIN_POST_HISTORY_SCAN,
  JOIN_POST_PIN_PAGES,
  JOIN_POST_PIN_REASON,
} from './join-post.constants';

/** Discord error codes that mean "you may not pin here" — not transient. */
const PIN_PERMISSION_CODES = new Set([50013, 50001]);
/** Discord's "maximum pins reached" (50 per channel). */
const PIN_CAP_CODE = 30003;

/** The rendered post. */
export interface JoinPostPayload {
  embeds: ChannelEmbed[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/** The parts of a Discord message the join-post flow reads and writes. */
export interface JoinPostMessage {
  id: string;
  pinned: boolean;
  author: { id: string };
  embeds: ReadonlyArray<{ author: { name: string } | null }>;
  edit(payload: JoinPostPayload): Promise<unknown>;
  pin(reason?: string): Promise<unknown>;
}

/** The parts of a text channel the join-post flow needs. */
export interface JoinPostChannel {
  id: string;
  send(payload: JoinPostPayload): Promise<JoinPostMessage>;
  messages: {
    fetch(options: {
      message: string;
      force: boolean;
    }): Promise<JoinPostMessage>;
    fetch(options: {
      limit: number;
    }): Promise<{ values(): Iterable<JoinPostMessage> }>;
    fetchPins(options?: { before?: number }): Promise<{
      items: ReadonlyArray<{
        message: JoinPostMessage;
        pinnedTimestamp: number;
      }>;
      hasMore: boolean;
    }>;
    delete(id: string): Promise<unknown>;
  };
}

/** Pin result surfaced to the admin. */
export interface JoinPostPinResult {
  pinned: boolean;
  warning: string | null;
}

/** The Discord error code on a rejection, when there is one. */
export function discordErrorCode(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null;
  const { code } = err;
  return typeof code === 'number' ? code : null;
}

/**
 * Fetch the stored post, or null when Discord no longer has it (10008).
 *
 * @throws Every other error, unchanged (transient ≠ gone).
 */
export async function readStored(
  channel: JoinPostChannel,
  messageId: string,
): Promise<JoinPostMessage | null> {
  try {
    // force: a cached copy can outlive a delete the gateway never reported.
    return await channel.messages.fetch({ message: messageId, force: true });
  } catch (err) {
    if (isUnknownMessage(err)) return null;
    throw err;
  }
}

/** Whether a message is the bot's own join post. */
export function isOwnJoinPost(
  message: JoinPostMessage,
  botUserId: string,
): boolean {
  return (
    message.author.id === botUserId &&
    message.embeds.some((e) => e.author?.name === JOIN_POST_AUTHOR)
  );
}

/**
 * Walk the channel's pins page by page (Discord serves 50 per page), newest
 * first, until the bot's own post turns up or the pins run out.
 */
async function scanPins(
  channel: JoinPostChannel,
  botUserId: string,
): Promise<JoinPostMessage | null> {
  let before: number | undefined;
  for (let page = 0; page < JOIN_POST_PIN_PAGES; page += 1) {
    const pins = await channel.messages.fetchPins(
      before === undefined ? undefined : { before },
    );
    const own = pins.items.find((pin) => isOwnJoinPost(pin.message, botUserId));
    if (own) return own.message;
    const oldest = pins.items.at(-1);
    if (!pins.hasMore || !oldest) return null;
    before = oldest.pinnedTimestamp;
  }
  return null;
}

async function scanForJoinPost(
  channel: JoinPostChannel,
  botUserId: string,
): Promise<JoinPostMessage | null> {
  const pinned = await scanPins(channel, botUserId);
  if (pinned) return pinned;
  const recent = await channel.messages.fetch({
    limit: JOIN_POST_HISTORY_SCAN,
  });
  return [...recent.values()].find((m) => isOwnJoinPost(m, botUserId)) ?? null;
}

/**
 * Rediscover the bot's own join post (pins first, then recent history).
 * A failed scan answers null: with no id stored there is nothing to protect.
 */
export async function findOwnJoinPost(
  channel: JoinPostChannel,
  botUserId: string,
): Promise<JoinPostMessage | null> {
  try {
    return await scanForJoinPost(channel, botUserId);
  } catch {
    return null;
  }
}

function pinWarning(err: unknown): string {
  const code = discordErrorCode(err);
  if (code === PIN_CAP_CODE) {
    return "Posted, but couldn't pin it: this channel already has Discord's maximum of 50 pinned messages.";
  }
  if (code !== null && PIN_PERMISSION_CODES.has(code)) {
    return "Posted, but couldn't pin it: the bot is missing Pin Messages in this channel.";
  }
  const why = err instanceof Error ? err.message : String(err);
  return `Posted, but couldn't pin it: ${why}`;
}

/**
 * Pin the post unless it already is; a refusal becomes a warning.
 *
 * @param message - The post.
 * @param warn - Log sink for the refusal.
 */
export async function tryPin(
  message: JoinPostMessage,
  warn: (line: string) => void,
): Promise<JoinPostPinResult> {
  if (message.pinned) return { pinned: true, warning: null };
  try {
    await message.pin(JOIN_POST_PIN_REASON);
    return { pinned: true, warning: null };
  } catch (err) {
    const warning = pinWarning(err);
    warn(`Join post ${message.id}: ${warning}`);
    return { pinned: false, warning };
  }
}
