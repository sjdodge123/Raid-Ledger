/**
 * The single "a community-lineup match entered scheduling" hook (ROK-1473).
 *
 * Matches reach `status: 'scheduling'` from two places — the matching
 * algorithm (`lineups-matching.helpers`) and bandwagon/operator promotion
 * (`lineups-bandwagon.helpers`). Neither told the Discord layer, so
 * `SchedulingPollEmbedService` only ever ran `updateEmbed`, which returns
 * early on a NULL `embed_message_id`: the poll card was never posted and
 * every later re-render was a no-op.
 *
 * Both flip sites now call THIS function once their status write has
 * committed. `SchedulingPollEmbedService.onMatchEnteredScheduling` is the
 * only listener; a third flip site inherits the card by calling the hook.
 *
 * The event indirection (rather than injecting the scheduling service into
 * `LineupsService`) keeps `LineupsModule` free of a circular import on
 * `SchedulingModule`, mirroring `SIGNUP_EVENTS` → `discord-sync.listener`.
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';

/** Event names emitted for community-lineup match lifecycle changes. */
export const LINEUP_MATCH_EVENTS = {
  /** A match was written to `status: 'scheduling'` (payload below). */
  ENTERED_SCHEDULING: 'lineup.match.entered-scheduling',
} as const;

/** Payload of {@link LINEUP_MATCH_EVENTS.ENTERED_SCHEDULING}. */
export interface MatchEnteredSchedulingPayload {
  /** `community_lineup_matches.id` of the match that entered scheduling. */
  matchId: number;
}

const logger = new Logger('LineupMatchSchedulingHook');

/**
 * Announce that one or more matches entered the scheduling phase.
 *
 * Call AFTER the status write commits and OUTSIDE any transaction — a
 * rolled-back flip must not leave an announced-but-absent poll. Failures are
 * logged and swallowed so a Discord problem can never block the phase change.
 *
 * @param events - Application event bus.
 * @param matchIds - Match id, or the ids flipped by this write (may be empty).
 */
export function fireMatchEnteredScheduling(
  events: EventEmitter2,
  matchIds: number[] | number,
): void {
  const ids = typeof matchIds === 'number' ? [matchIds] : matchIds;
  for (const matchId of ids) {
    try {
      events.emit(LINEUP_MATCH_EVENTS.ENTERED_SCHEDULING, {
        matchId,
      } satisfies MatchEnteredSchedulingPayload);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Failed to announce scheduling phase for match ${matchId}: ${msg}`,
      );
    }
  }
}
