/**
 * ROK-1428 Codex r9 P2 — post-commit emits of a Quick Play spawn. Quick Play
 * bypasses `EventsService`, so `event.created` never fires for it; the
 * channel lifecycle nudge hears about a new one through
 * `AD_HOC_EVENTS.QUICK_PLAY_CREATED` instead. Call only after the spawn's
 * transaction has committed.
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AD_HOC_EVENTS,
  type AdHocParticipantJoinedPayload,
  type AdHocQuickPlayCreatedPayload,
} from '../discord-bot.constants';

/** The emitter slice the spawn paths use. */
export type SpawnEmitter = Pick<EventEmitter2, 'emit'>;

/** Announce a committed Quick Play row. */
export function emitQuickPlayCreated(
  emitter: SpawnEmitter | undefined,
  eventId: number,
  gameId: number | null,
): void {
  const payload: AdHocQuickPlayCreatedPayload = { eventId, gameId };
  emitter?.emit(AD_HOC_EVENTS.QUICK_PLAY_CREATED, payload);
}

/** Voice spawn: announce only a created row, never a join of a live one. */
export function emitVoiceSpawn(
  emitter: SpawnEmitter | undefined,
  created: { eventId: number; existing: boolean },
  gameId: number | null | undefined,
): void {
  if (created.existing) return;
  emitQuickPlayCreated(emitter, created.eventId, gameId ?? null);
}

/** Server spawn: the creation, then each genuinely new participation. */
export function emitServerSpawn(
  emitter: SpawnEmitter,
  eventId: number,
  gameId: number,
  joined: readonly (number | null)[],
): void {
  emitQuickPlayCreated(emitter, eventId, gameId);
  for (const userId of joined) {
    const payload: AdHocParticipantJoinedPayload = { eventId, userId };
    emitter.emit(AD_HOC_EVENTS.PARTICIPANT_JOINED, payload);
  }
}
