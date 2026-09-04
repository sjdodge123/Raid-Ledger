/**
 * ROK-1446 D5/D7/D8 — one flush of one bound lobby channel.
 *
 * Extracted from `ChannelPresenceEmbedService` so the service owns only the
 * dirty set, the timer and the six frozen public methods, and so the whole
 * send/edit/close ladder is assertable without a Nest module.
 *
 * The ladder, in order, is the whole contract:
 * 1. no binding  → recap what we can, close the row `unbound`;
 * 2. room empty  → stamp `empty_since`, render the recap, close once the
 *    binding's grace has elapsed AND no session is still live (D8);
 * 3. room live   → open the row + post on first occupancy, otherwise edit in
 *    place — and only when the payload hash actually moved (D5/AC5).
 */
import type { Logger } from '@nestjs/common';
import {
  editEmbeds,
  isUnknownMessage,
  sendEmbeds,
} from '../discord-bot-client.messages.helpers';
import type { ChannelEmbed } from '../embeds/embed-chrome.helpers';
import {
  resolveVoiceChannel,
  type ResolvedBinding,
} from '../listeners/voice-state.helpers';
import type { EmbedEventData } from './discord-embed.factory';
import {
  buildContext,
  resolveNotificationChannel,
} from './ad-hoc-notification.helpers';
import {
  graceMs,
  hydrateRecap,
  isCloseDue,
  payloadHashOf,
  renderLiveMessage,
  renderRecapMessage,
} from './channel-presence-flush.helpers';
import {
  findLinkedEvents,
  resolveRoom,
  type ResolvedRoom,
  type RoomResolveDeps,
  type RoomSnapshot,
} from './channel-presence-room.helpers';
import {
  clearEmpty,
  closeRow,
  findOpenRow,
  markEmpty,
  openRow,
  savePayloadHash,
  type PresenceRow,
} from './channel-presence-store.helpers';

/** Everything one flush needs; assembled fresh by the service each tick. */
export interface ChannelFlush {
  deps: RoomResolveDeps;
  channelId: string;
  guildId: string;
  /** `null` when no `general-lobby` binding owns this channel any more. */
  binding: ResolvedBinding | null;
  /** DEMO_MODE seam (D12); replaces the Discord read only. */
  override?: RoomSnapshot | null;
  logger: Logger;
  now?: number;
}

/** Internal shape once the row and the render context are resolved. */
interface FlushState {
  flush: ChannelFlush;
  row: PresenceRow;
  now: number;
}

/**
 * Re-derive one room from truth and reconcile its message with it (D4).
 *
 * Never throws for an expected condition — an unresolvable text channel or a
 * room with nothing open simply returns. Transport failures DO propagate so
 * the caller can log them per channel and keep the tick alive.
 *
 * @param flush - The channel, its binding, and the deps to resolve both.
 */
export async function flushChannel(flush: ChannelFlush): Promise<void> {
  const now = flush.now ?? Date.now();
  const { deps, channelId, guildId, binding } = flush;
  const row = await findOpenRow(deps.db, guildId, channelId);
  if (!binding) {
    if (row) await closeUnbound({ flush, row, now });
    return;
  }
  const room = await resolveRoom(deps, channelId, binding, flush.override);
  if (room.channelResolved === false) {
    // A cold `guild.channels.cache` resolves to `memberCount: 0`, which is
    // indistinguishable from a genuinely empty room — and `recover()` marks
    // every open row dirty at exactly the moment the cache is coldest. Doing
    // NOTHING is the only safe reaction: `empty_since` stays unstamped, the
    // grace clock does not start, and the live message is left alone (S-2).
    flush.logger.warn(
      `Voice channel ${channelId} did not resolve; skipping presence flush`,
    );
    return;
  }
  if (room.memberCount === 0) {
    if (row) await flushEmpty({ flush, row, now }, room, binding);
    return;
  }
  await flushLive(flush, row, room, now);
}

/** Room has humans: open + post on first occupancy, else edit in place. */
async function flushLive(
  flush: ChannelFlush,
  row: PresenceRow | null,
  room: ResolvedRoom,
  now: number,
): Promise<void> {
  const context = await buildContext(flush.deps);
  const openedAt = row?.openedAt ?? new Date(now);
  const embeds = renderLiveMessage(room, context, openedAt, now);
  if (!row) {
    await openMessage(flush, embeds);
    return;
  }
  // A rejoin inside the grace flips THIS message back to live rather than
  // opening a second one (D8) — the stamp must clear before the close check.
  if (row.emptySince) await clearEmpty(flush.deps.db, row.id);
  await publish({ flush, row, now }, embeds);
}

/** Room is empty: stamp, recap, and close once D8's both clauses hold. */
async function flushEmpty(
  state: FlushState,
  room: ResolvedRoom,
  binding: ResolvedBinding,
): Promise<void> {
  const { flush, row, now } = state;
  const emptySince = row.emptySince ?? new Date(now);
  if (!row.emptySince) await markEmpty(flush.deps.db, row.id, emptySince);
  const events = await hydrateRecap(flush.deps, row.bindingId, row.openedAt);
  await renderAndPublishRecap(state, {
    channelName: room.channelName,
    endedAt: emptySince.getTime(),
    events,
  });
  const live = row.bindingId
    ? await findLinkedEvents(flush.deps.db, row.bindingId)
    : [];
  if (isCloseDue(emptySince, graceMs(binding.config), now, live)) {
    await closeRow(flush.deps.db, row.id, 'empty');
  }
}

/**
 * The binding is gone (deleted mid-session, `binding_id` now NULL).
 *
 * The message still gets its recap — the sessions it covered really happened —
 * and then the row closes immediately: there is no grace to wait out, because
 * nothing can reopen a room that has no binding.
 */
async function closeUnbound(state: FlushState): Promise<void> {
  const { flush, row } = state;
  if (row.bindingId === null) {
    // The binding was DELETED (ON DELETE SET NULL nulled this column), which
    // is the only way to reach here with no binding id — and it is also the
    // only key `hydrateRecap` could search by, so it can only return []. The
    // recap would therefore overwrite a true record of the room's sessions
    // with "No session started." at exactly the moment it becomes history.
    // Close without publishing: the last good render is strictly more accurate
    // than an empty recap (S-7 / P2-2).
    flush.logger.warn(
      `Presence row ${row.id} lost its binding; closing without rewriting its last render`,
    );
  } else {
    const events = await hydrateRecap(flush.deps, row.bindingId, row.openedAt);
    await renderAndPublishRecap(state, {
      // The BINDING went away, not necessarily the channel — so ask.
      channelName:
        resolveVoiceChannel(flush.deps.clientService, flush.channelId)?.name ??
        null,
      endedAt: row.emptySince?.getTime() ?? null,
      events,
    });
  }
  await closeRow(flush.deps.db, row.id, 'unbound');
}

/** Edit the message into the recap of the sessions it covered. */
async function renderAndPublishRecap(
  state: FlushState,
  recap: {
    channelName: string | null;
    /** `empty_since`; the stable instant the sessions ended (S-5). */
    endedAt: number | null;
    events: EmbedEventData[];
  },
): Promise<void> {
  const { flush, row, now } = state;
  const context = await buildContext(flush.deps);
  const embeds = renderRecapMessage(
    { ...recap, openedAt: row.openedAt },
    context,
    now,
  );
  await publish(state, embeds);
}

/**
 * First occupancy: post the message, then record it (D7 — the DB is truth).
 *
 * `openRow` is a partial-index-safe upsert, so a lost race returns the row
 * that won rather than throwing. The hash is stored only for the row we
 * actually posted; on a lost race the winner's message is the live one and its
 * own flush owns the hash.
 */
async function openMessage(
  flush: ChannelFlush,
  embeds: ChannelEmbed[],
): Promise<void> {
  const binding = flush.binding;
  if (!binding) return;
  const textChannelId = await resolveNotificationChannel(
    flush.deps,
    binding.bindingId,
    null,
  );
  if (!textChannelId) {
    flush.logger.warn(
      `No text channel resolved for lobby presence in ${flush.channelId}`,
    );
    return;
  }
  const client = flush.deps.clientService.getClient();
  const message = await sendEmbeds(client, textChannelId, embeds);
  await recordOpenedMessage(flush, binding.bindingId, {
    textChannelId,
    messageId: message.id,
    embeds,
  });
}

/** Write the ledger row for a message we just posted, or disown it on a race. */
async function recordOpenedMessage(
  flush: ChannelFlush,
  bindingId: string,
  posted: { textChannelId: string; messageId: string; embeds: ChannelEmbed[] },
): Promise<void> {
  const result = await openRow(flush.deps.db, {
    guildId: flush.guildId,
    voiceChannelId: flush.channelId,
    bindingId,
    textChannelId: posted.textChannelId,
    messageId: posted.messageId,
  });
  if (!result.created) {
    flush.logger.warn(
      `Presence row for ${flush.channelId} was opened concurrently; message ${posted.messageId} is orphaned`,
    );
    return;
  }
  await savePayloadHash(
    flush.deps.db,
    result.row.id,
    payloadHashOf(posted.embeds),
  );
}

/**
 * Edit the tracked message — but ONLY when the render actually changed (AC5).
 *
 * An unchanged payload issues no `editEmbeds` call at all, which is the whole
 * point of hashing: a busy room that keeps re-resolving to the same picture
 * costs zero Discord calls. The new hash lands only AFTER the edit resolves,
 * so a rejected edit leaves the old hash in place and retries next tick.
 */
async function publish(
  state: FlushState,
  embeds: ChannelEmbed[],
): Promise<void> {
  const { flush, row } = state;
  const hash = payloadHashOf(embeds);
  if (hash === row.payloadHash) return;
  try {
    await editEmbeds(
      flush.deps.clientService.getClient(),
      row.textChannelId,
      row.messageId,
      embeds,
    );
  } catch (error) {
    if (!isUnknownMessage(error)) throw error;
    // The message was deleted after recovery adopted it. 10008 is the one
    // Discord error a retry can never fix, and leaving the row `open` wedges
    // the channel FOREVER: every future occupancy finds it and edits the dead
    // id instead of posting a replacement, while the reaper sees a healthy
    // row. Close it `missing` - the same treatment the recovery path already
    // gives a 10008 - so the next flush opens a fresh message. Swallowed
    // deliberately: this is handled, so it must not spend an S-1 retry
    // (P2-1). No DB statement has failed here, so there is no transaction to
    // poison.
    flush.logger.warn(
      `Presence message ${row.messageId} is gone; closing row ${row.id} so the next flush reposts`,
    );
    await closeRow(flush.deps.db, row.id, 'missing');
    return;
  }
  await savePayloadHash(flush.deps.db, row.id, hash);
}
