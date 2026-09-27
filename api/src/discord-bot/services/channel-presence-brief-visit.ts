/**
 * ROK-1692 — a drive-by visit to a lobby room leaves no card behind.
 *
 * The presence message posts on the first human (ROK-1446 AC1), so a 10-second
 * mis-click into General used to leave a permanent "session ended · 0m" card
 * naming whoever clicked (prod, 2026-09-26: an 8 s and a ~20 s visit). Operator
 * ruling: when the room empties and the visit was under two minutes with
 * nothing happening, delete the card instead of recapping it.
 */
import { deleteMessage } from '../discord-bot-client.messages.helpers';
import type { ChannelFlush } from './channel-presence-flush';
import type { RoomRecap } from './channel-presence-room-recap.helpers';
import type { LinkedEvent } from './channel-presence-room.helpers';
import { closeRow, type PresenceRow } from './channel-presence-store.helpers';
import type { EmbedEventData } from './discord-embed.factory';

/** A room emptied sooner than this after it opened is a drive-by visit. */
export const BRIEF_VISIT_MS = 120_000;

/** What the empty flush already knows about the session that just ended. */
export interface BriefVisitInput {
  openedAt: Date;
  emptySince: Date;
  /** Ad-hoc sessions the recap would render (`hydrateRecap`). */
  events: EmbedEventData[];
  /** Sessions still linked to the binding (`findLinkedEvents`). */
  live: LinkedEvent[];
  /** The room's detected games; empty = "no game detected". */
  activities: RoomRecap['activities'];
}

/**
 * Under two minutes AND nothing happened: no game detected, no linked event.
 * Anything else recaps exactly as before.
 */
export function isBriefVisit(input: BriefVisitInput): boolean {
  const spanMs = input.emptySince.getTime() - input.openedAt.getTime();
  return (
    spanMs < BRIEF_VISIT_MS &&
    input.events.length === 0 &&
    input.live.length === 0 &&
    input.activities.length === 0
  );
}

/**
 * Delete the card and close the row `brief` at `empty_since`.
 *
 * A failed delete (10008 already gone, 50013 missing permissions, a transport
 * fault) never throws out of the flush: a card we could not delete is still a
 * finished session, and leaving the row open would only retry the delete on
 * every tick. A rejoin afterwards opens a fresh row and message.
 */
export async function retireBriefVisit(
  flush: ChannelFlush,
  row: PresenceRow,
  emptySince: Date,
): Promise<void> {
  try {
    await deleteMessage(
      flush.deps.clientService.getClient(),
      row.textChannelId,
      row.messageId,
    );
  } catch (error) {
    flush.logger.warn(
      `Brief-visit presence message ${row.messageId} could not be deleted (${String(error)}); closing row ${row.id} anyway`,
    );
  }
  await closeRow(flush.deps.db, row.id, 'brief', emptySince);
  flush.roomRecaps?.delete(row.id);
  flush.logger.log(
    `Presence row ${row.id} for ${flush.channelId} was a brief visit (<${String(BRIEF_VISIT_MS / 1000)}s, nothing happened); card deleted (ROK-1692)`,
  );
}
