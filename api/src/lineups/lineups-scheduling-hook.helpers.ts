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
  /** A re-decide wiped matches that owned poll cards (TDB:571). */
  POLL_CARDS_ORPHANED: 'lineup.match.poll-cards-orphaned',
} as const;

/** A Discord poll card left behind by a wiped match (TDB:571). */
export interface OrphanedPollCard {
  channelId: string;
  messageId: string;
}

/** Payload of {@link LINEUP_MATCH_EVENTS.POLL_CARDS_ORPHANED}. */
export interface PollCardsOrphanedPayload {
  cards: OrphanedPollCard[];
}

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

/**
 * Hand the poll cards a re-decide wiped to the Discord layer for deletion
 * (TDB:571). Same contract as {@link fireMatchEnteredScheduling}: call after
 * the wipe commits, outside any transaction; failures are logged, not thrown.
 *
 * @param events - Application event bus.
 * @param cards - Cards whose match rows the wipe deleted (may be empty).
 */
export function fireOrphanedPollCards(
  events: EventEmitter2,
  cards: OrphanedPollCard[],
): void {
  if (cards.length === 0) return;
  try {
    events.emit(LINEUP_MATCH_EVENTS.POLL_CARDS_ORPHANED, {
      cards,
    } satisfies PollCardsOrphanedPayload);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to hand off ${cards.length} orphaned cards: ${msg}`);
  }
}
