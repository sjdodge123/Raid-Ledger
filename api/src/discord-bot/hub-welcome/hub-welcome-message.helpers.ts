/**
 * ROK-1933 Part 4 — find, edit or post the hub welcome. Reuses the ROK-1740
 * join-post read/scan/pin helpers (structural Discord types; the spec fakes
 * are the whole contract) instead of forking them.
 *
 * - A stored id is read with `readStored`: only Unknown Message (10008)
 *   counts as gone; any other failure is rethrown so a transient never
 *   produces a duplicate welcome.
 * - With no usable id, the channel's pins + recent history are scanned for
 *   our own welcome: bot author AND the "Raid Ledger" author line AND this
 *   hub's title ("<hub> on Raid Ledger"). The author line alone is too
 *   generic, and one channel can carry several hubs' welcomes (auto-link
 *   binds every hub of a game to the game's channel).
 */
import { isUnknownMessage } from '../discord-bot-client.messages.helpers';
import {
  findOwnMessage,
  readStored,
  type JoinPostChannel,
  type JoinPostMessage,
  type JoinPostPayload,
} from '../join-post/join-post-message.helpers';
import { HUB_WELCOME_COPY } from './hub-welcome.constants';

/** What happened to the welcome on a write. */
export type HubWelcomeOutcome = 'posted' | 'edited';

/** A written welcome: the live message and how it got there. */
export interface HubWelcomeWritten {
  message: JoinPostMessage;
  result: HubWelcomeOutcome;
}

/**
 * Whether `message` is the bot's own welcome for the hub named `hubName`.
 *
 * @param message - Candidate message.
 * @param botUserId - The bot's Discord user id.
 * @param hubName - The hub's display name (the embed title's prefix).
 */
export function isOwnHubWelcome(
  message: JoinPostMessage,
  botUserId: string,
  hubName: string,
): boolean {
  if (message.author.id !== botUserId) return false;
  const title = HUB_WELCOME_COPY.title(hubName);
  return message.embeds.some(
    (e) => e.author?.name === HUB_WELCOME_COPY.author && e.title === title,
  );
}

/**
 * The message to edit: the stored one when Discord still has it, else our own
 * welcome found by a pins/history scan (a lost send reply leaves an orphan).
 *
 * @throws Any non-10008 failure reading the stored id.
 */
export async function locateHubWelcome(
  channel: JoinPostChannel,
  storedId: string | null,
  botUserId: string,
  hubName: string,
): Promise<JoinPostMessage | null> {
  const stored = storedId ? await readStored(channel, storedId) : null;
  if (stored) return stored;
  return findOwnMessage(channel, (m) => isOwnHubWelcome(m, botUserId, hubName));
}

/** Edit in place; null when Discord says the message is gone (10008 only). */
async function editOrGone(
  message: JoinPostMessage,
  payload: JoinPostPayload,
): Promise<JoinPostMessage | null> {
  try {
    await message.edit(payload);
    return message;
  } catch (err) {
    if (isUnknownMessage(err)) return null;
    throw err;
  }
}

/**
 * Edit the located welcome, or post a fresh one when there is none or it
 * vanished between the read and the edit.
 *
 * @param channel - Target channel.
 * @param located - From {@link locateHubWelcome}.
 * @param payload - Rendered embed + link row.
 * @throws Any non-10008 edit failure and any send failure.
 */
export async function writeHubWelcome(
  channel: JoinPostChannel,
  located: JoinPostMessage | null,
  payload: JoinPostPayload,
): Promise<HubWelcomeWritten> {
  if (located) {
    const edited = await editOrGone(located, payload);
    if (edited) return { message: edited, result: 'edited' };
  }
  return { message: await channel.send(payload), result: 'posted' };
}
