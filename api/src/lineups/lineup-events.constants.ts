/**
 * Application-level event names for the lineup lifecycle (ROK-1457).
 *
 * `DECIDED` fires from `runStatusTransition`'s decided block AFTER the winner
 * is written and the matching algorithm has run, so a consumer reading the
 * row sees `decided_game_id` and the match rows. Emitted fire-and-forget:
 * a consumer failure can never roll back or slow the transition.
 */
import type {
  LineupStatusDto,
  LineupVisibilityDto,
  ScheduleVoteStance,
} from '@raid-ledger/contract';

export const LINEUP_EVENTS = {
  DECIDED: 'lineup.decided',
} as const;

/** Payload emitted with {@link LINEUP_EVENTS.DECIDED}. */
export interface LineupDecidedPayload {
  lineupId: number;
}

/*
 * ROK-2272 S6 — lifecycle events for the `event-planning` forum. Nothing
 * listens yet (S7/S8/S10 add the listeners). Every emit site fires AFTER its
 * DB write has committed, outside any transaction, and fire-and-forget via
 * `lineup-lifecycle-emit.helpers` so a listener can never roll back or slow
 * the write. The poll (match-level) names live on `LINEUP_MATCH_EVENTS` in
 * `lineups-scheduling-hook.helpers`, beside the existing match events.
 */
export const LINEUP_LIFECYCLE_EVENTS = {
  /** A lineup row was inserted (status `building`). */
  CREATED: 'lineup.created',
  /** A lineup's `status` changed (any edge, including abort → archived). */
  STATUS_CHANGED: 'lineup.status-changed',
} as const;

/** Payload emitted with {@link LINEUP_LIFECYCLE_EVENTS.CREATED}. */
export interface LineupCreatedPayload {
  lineupId: number;
  /** Private lineups never get a forum post (spec §3.7). */
  visibility: LineupVisibilityDto;
  /** The hub the lineup is tagged to; `null` when untagged. */
  guildId: number | null;
  /** A standalone poll's hidden carrier row, NOT a lineup subject (§3.1). */
  standalone: boolean;
}

/**
 * Payload emitted with {@link LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED}.
 *
 * `to: 'decided'` fires BEFORE the matching pass — a listener that needs the
 * match rows keys on `LINEUP_MATCH_EVENTS.ENTERED_SCHEDULING` instead.
 */
export interface LineupStatusChangedPayload {
  lineupId: number;
  from: LineupStatusDto;
  to: LineupStatusDto;
  /**
   * A standalone poll's carrier row (never a lineup subject, §3.1). Always
   * known: carriers are inserted `decided`, so only the standalone archive
   * edges can carry `true`.
   */
  standalone: boolean;
  /**
   * Present only when the emitting path had the lineup row loaded (create,
   * runStatusTransition, abort). Absent on the tiebreaker, tie-expiry and
   * standalone-archive edges — a listener must read `community_lineups`.
   */
  visibility?: LineupVisibilityDto;
  /** Same presence rule as `visibility`; `null` = loaded but untagged. */
  guildId?: number | null;
}

/** Payload of `LINEUP_MATCH_EVENTS.POLL_VOTED` (one committed slot tap). */
export interface PollVotedPayload {
  matchId: number;
  lineupId: number;
  userId: number;
  /** The voter's resulting stance for the tapped slot; `null` = cleared. */
  stance: ScheduleVoteStance | null;
}

/** Payload of `LINEUP_MATCH_EVENTS.POLL_LOCKED_IN` (match → `scheduled`). */
export interface PollLockedInPayload {
  matchId: number;
  /** The linked event; `null` for a standalone poll completed eventless. */
  eventId: number | null;
}

/**
 * Payload of `LINEUP_MATCH_EVENTS.POLL_OPENED` — a standalone scheduling poll
 * was created. A lineup match entering scheduling keeps its existing
 * `ENTERED_SCHEDULING { matchId }` event (its listener resolves the rest).
 */
export interface PollOpenedPayload {
  matchId: number;
  lineupId: number;
  /** The hub the poll is tagged to; `null` when untagged. */
  guildId: number | null;
  visibility: LineupVisibilityDto;
}

/** Payload of `LINEUP_MATCH_EVENTS.POLL_CANCELLED` (match → `archived`). */
export interface PollCancelledPayload {
  matchId: number;
  lineupId: number;
  reason: string | null;
}
