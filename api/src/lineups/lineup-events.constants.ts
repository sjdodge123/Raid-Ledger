/**
 * Application-level event names for the lineup lifecycle (ROK-1457).
 *
 * `DECIDED` fires from `runStatusTransition`'s decided block AFTER the winner
 * is written and the matching algorithm has run, so a consumer reading the
 * row sees `decided_game_id` and the match rows. Emitted fire-and-forget:
 * a consumer failure can never roll back or slow the transition.
 */
export const LINEUP_EVENTS = {
  DECIDED: 'lineup.decided',
} as const;

/** Payload emitted with {@link LINEUP_EVENTS.DECIDED}. */
export interface LineupDecidedPayload {
  lineupId: number;
}
