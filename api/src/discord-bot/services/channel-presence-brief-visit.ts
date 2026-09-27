/**
 * ROK-1692 — a drive-by visit to a lobby room leaves no card behind.
 *
 * The presence message posts on the first human (ROK-1446 AC1), so a 10-second
 * mis-click into General used to leave a permanent "session ended · 0m" card
 * naming whoever clicked (prod, 2026-09-26: an 8 s and a ~20 s visit). Operator
 * ruling: when the room empties and the visit was under two minutes with
 * nothing happening, delete the card instead of recapping it.
 */
import {
  deleteMessage,
  isUnknownMessage,
} from '../discord-bot-client.messages.helpers';
import type { ChannelFlush } from './channel-presence-flush';
import { hydrateRecap } from './channel-presence-flush.helpers';
import { roomRecapFor } from './channel-presence-flush.occupancy';
import type { RoomRecap } from './channel-presence-room-recap.helpers';
import {
  findLinkedEvents,
  type LinkedEvent,
} from './channel-presence-room.helpers';
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
 * Never throws out of the flush. A 10008 means the card is already gone, which
 * is the outcome we wanted, so the row closes `brief`. Any OTHER failure (50013
 * missing permissions, a transport fault) leaves the card in the channel, so
 * this returns `false` and the caller falls back to the normal recap edit and
 * `empty` close: the channel must never keep a card for an empty room that
 * nothing will ever touch again.
 *
 * @returns `true` when the card is gone and the row is closed `brief`.
 */
export async function retireBriefVisit(
  flush: ChannelFlush,
  row: PresenceRow,
  emptySince: Date,
): Promise<boolean> {
  try {
    await deleteMessage(
      flush.deps.clientService.getClient(),
      row.textChannelId,
      row.messageId,
    );
  } catch (error) {
    if (!isUnknownMessage(error)) {
      flush.logger.warn(
        `Brief-visit presence message ${row.messageId} could not be deleted (${String(error)}); recapping row ${row.id} instead`,
      );
      return false;
    }
  }
  await closeRow(flush.deps.db, row.id, 'brief', emptySince);
  flush.roomRecaps?.delete(row.id);
  flush.logger.log(
    `Presence row ${row.id} for ${flush.channelId} was a brief visit (<${String(BRIEF_VISIT_MS / 1000)}s, nothing happened); card deleted (ROK-1692)`,
  );
  return true;
}

/** What the empty-room ladder reads about a session that ended. */
export interface EndedSession {
  /** Ad-hoc sessions the recap renders (`hydrateRecap`). */
  events: EmbedEventData[];
  /** Sessions still linked to the binding (`findLinkedEvents`). */
  live: LinkedEvent[];
  /** Who was in the room and what they played. */
  room: RoomRecap;
}

/** Read the ended session once, for both the recap and the brief decision. */
export async function loadEndedSession(
  flush: ChannelFlush,
  row: PresenceRow,
  ended: { bindingId: string; emptySince: Date; now: number },
): Promise<EndedSession> {
  const events = await hydrateRecap(flush.deps, ended.bindingId, row.openedAt);
  const room = await roomRecapFor(flush, row, ended.emptySince, ended.now);
  const live = await findLinkedEvents(flush.deps.db, ended.bindingId);
  return { events, live, room };
}

/** `isBriefVisit` over what `loadEndedSession` read. */
export function isBriefSession(
  row: PresenceRow,
  emptySince: Date,
  session: EndedSession,
): boolean {
  return isBriefVisit({
    openedAt: row.openedAt,
    emptySince,
    events: session.events,
    live: session.live,
    activities: session.room.activities,
  });
}

/**
 * Drop every session that began at or after `emptySince`: it belongs to a
 * LATER visit, not the one that ended. The join-side check runs after a
 * rejoin's live flush, which may already have spawned a fresh linked session
 * on the binding (a `minPlayers: 1` lobby does it on the first human); both
 * binding-wide reads would see it and keep a drive-by card forever.
 *
 * `live` carries no start time, so it is bounded through the recap's own
 * `startTime` by id. A live session the recap did not hydrate, or an
 * unparseable start, is kept: the fallback is the old recap, never a
 * wrongly deleted card.
 */
export function startedBefore(
  session: EndedSession,
  emptySince: Date,
): EndedSession {
  const cutoff = emptySince.getTime();
  const later = new Set(
    session.events
      .filter((event) => Date.parse(event.startTime) >= cutoff)
      .map((event) => event.id),
  );
  return {
    ...session,
    events: session.events.filter((event) => !later.has(event.id)),
    live: session.live.filter((event) => !later.has(event.id)),
  };
}

/**
 * The join-side half: someone rejoined after the grace ran out but before the
 * re-check closed the row, so the live flush is retiring it (ROK-1498). A
 * brief visit's card is deleted there too; otherwise its "<1m" recap would
 * stay in the channel forever beside the fresh card. Only sessions that began
 * before the room emptied count (`startedBefore`).
 *
 * @returns `true` when the card is gone and the row is closed `brief`; `false`
 *   for a real session or a failed delete, which the caller closes `stale`.
 */
export async function retireIfBrief(
  flush: ChannelFlush,
  row: PresenceRow,
  bindingId: string,
  now: number,
): Promise<boolean> {
  const { emptySince } = row;
  if (!emptySince) return false;
  // A session this long cannot be brief: skip the three reads.
  if (emptySince.getTime() - row.openedAt.getTime() >= BRIEF_VISIT_MS) {
    return false;
  }
  const ended = { bindingId, emptySince, now };
  const session = await loadEndedSession(flush, row, ended);
  const visit = startedBefore(session, emptySince);
  if (!isBriefSession(row, emptySince, visit)) return false;
  return retireBriefVisit(flush, row, emptySince);
}
