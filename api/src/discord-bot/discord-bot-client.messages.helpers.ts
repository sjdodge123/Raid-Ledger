/**
 * ROK-1446 D10 — multi-embed transport for the channel-presence message.
 *
 * `DiscordBotClientService.sendEmbed` / `editEmbed` are single-embed by
 * signature, and that service sits at 296/300 counted lines, so this is a NEW
 * leaf module rather than two more methods there. It takes the raw `Client`
 * (`clientService.getClient()`) and resolves the channel with exactly the
 * idiom `DiscordBotClientService.fetchTextChannel` uses
 * (`discord-bot-client.service.ts:359-368`) so a channel that resolves for one
 * path resolves for the other.
 *
 * Two invariants live here:
 * - **`components: []` on every write.** The design prose describes a link
 *   button row; the "Decisions taken · 2026-09-01" list supersedes it — this
 *   family of embeds carries masked links and NO components. Sending it
 *   explicitly on edits also strips any row a previous message shape left.
 * - **10008 is the only swallowed failure.** D7 turns a `null` from
 *   `fetchMessageOrNull` into `close_reason='missing'`. If a transient fault
 *   (missing access, rate limit, socket hang up) also returned `null`, every
 *   blip would close a live room's row and orphan its message.
 */
import {
  DiscordAPIError,
  type Client,
  type EmbedBuilder,
  type Message,
  type TextChannel,
} from 'discord.js';

/** Discord API error code for "Unknown Message" — the message is gone. */
export const UNKNOWN_MESSAGE = 10008;

/**
 * Resolve a sendable text channel from the raw client.
 *
 * Mirrors `DiscordBotClientService.fetchTextChannel` verbatim, including both
 * error messages, so failures read identically whichever path produced them.
 */
async function fetchTextChannel(
  client: Client | null,
  channelId: string,
): Promise<TextChannel> {
  if (!client?.isReady()) {
    throw new Error('Discord bot is not connected');
  }
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }
  return channel as TextChannel;
}

/**
 * Post one message carrying the whole rendered embed array (lead + groups).
 *
 * Discord caps a message at 10 embeds; the render enforces that upstream
 * (`applyBudget`, D11). No `content` is sent — the presence message is a live
 * object, not a notification.
 */
export async function sendEmbeds(
  client: Client | null,
  channelId: string,
  embeds: EmbedBuilder[],
): Promise<Message> {
  const channel = await fetchTextChannel(client, channelId);
  return channel.send({ embeds, components: [] });
}

/**
 * Edit the tracked presence message in place with a freshly rendered array.
 *
 * Errors propagate on purpose: the flush loop only stores the new payload hash
 * after the edit resolves, so a rejected edit must reach the caller to be
 * retried on the next tick (D5).
 */
export async function editEmbeds(
  client: Client | null,
  channelId: string,
  messageId: string,
  embeds: EmbedBuilder[],
): Promise<Message> {
  const channel = await fetchTextChannel(client, channelId);
  const message = await channel.messages.fetch(messageId);
  return message.edit({ embeds, components: [] });
}

/**
 * Is this Discord's "Unknown Message" (10008)?
 *
 * Exported because BOTH presence paths need it and must react identically: the
 * recovery adoption path (fetch) and the flush edit path. A 10008 is the one
 * Discord error that is NOT transient — the message is gone and no retry can
 * bring it back — so the row must be closed rather than re-queued.
 *
 * The check is `instanceof DiscordAPIError`, not a duck-typed `code` read: a
 * caller faking this error in a test must build it with
 * `Object.create(DiscordAPIError.prototype)`.
 *
 * @param error - Anything thrown by a discord.js call.
 */
export function isUnknownMessage(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === UNKNOWN_MESSAGE;
}

/**
 * Fetch a tracked message, or `null` if Discord no longer has it (10008).
 *
 * Used by `recover()` (D7/AC8) to decide between adopting an open row and
 * closing it with `close_reason='missing'`. Every other error — including a
 * `DiscordAPIError` with a different code — is rethrown, because closing a row
 * on a transient fault would abandon a message that is still live.
 *
 * The check is `instanceof DiscordAPIError`, not a duck-typed `code` read: a
 * caller faking this error in a test must build it with
 * `Object.create(DiscordAPIError.prototype)`.
 */
export async function fetchMessageOrNull(
  client: Client | null,
  channelId: string,
  messageId: string,
): Promise<Message | null> {
  const channel = await fetchTextChannel(client, channelId);
  try {
    return await channel.messages.fetch(messageId);
  } catch (error) {
    if (isUnknownMessage(error)) return null;
    throw error;
  }
}
