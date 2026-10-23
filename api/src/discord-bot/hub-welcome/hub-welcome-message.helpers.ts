/**
 * ROK-1933 Part 4 — find, edit or post the hub welcome. Reuses the ROK-1740
 * join-post read/scan/pin helpers (structural Discord types; the spec fakes
 * are the whole contract) instead of forking them.
 *
 * - A stored id is read with `readStored`: only Unknown Message (10008)
 *   counts as gone; any other failure is rethrown so a transient never
 *   produces a duplicate welcome.
 * - With no usable id, the channel's pins + recent history are scanned for
 *   our own welcome: bot author AND the "Raid Ledger" author line AND a link
 *   button pointing at this hub's page (`/hubs/<id>`). The author line alone
 *   is too generic, and one channel can carry several hubs' welcomes
 *   (auto-link binds every hub of a game to the game's channel). The hub id
 *   — not the name in the title — is the marker, so a renamed hub still
 *   finds (and edits) its old welcome instead of posting a duplicate.
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

/** Whether `url`'s path ends at `/hubs/<hubId>` (a `#`/`?` suffix is fine). */
function linksToHub(url: string | null | undefined, hubId: number): boolean {
  if (!url) return false;
  const match = /\/hubs\/(\d+)(?:[#?]|$)/.exec(url);
  return match?.[1] === String(hubId);
}

/**
 * Whether `message` is the bot's own welcome for hub `hubId`: bot author,
 * the welcome's author line, and a button linking to that hub's page.
 *
 * @param message - Candidate message.
 * @param botUserId - The bot's Discord user id.
 * @param hubId - The hub (guild) id the "Open the hub" button links to.
 */
export function isOwnHubWelcome(
  message: JoinPostMessage,
  botUserId: string,
  hubId: number,
): boolean {
  if (message.author.id !== botUserId) return false;
  const authored = message.embeds.some(
    (e) => e.author?.name === HUB_WELCOME_COPY.author,
  );
  if (!authored) return false;
  return (message.components ?? []).some((row) =>
    (row.components ?? []).some((c) => linksToHub(c.url, hubId)),
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
  hubId: number,
): Promise<JoinPostMessage | null> {
  const stored = storedId ? await readStored(channel, storedId) : null;
  if (stored) return stored;
  return findOwnMessage(channel, (m) => isOwnHubWelcome(m, botUserId, hubId));
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
