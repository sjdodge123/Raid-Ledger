/**
 * ROK-2272 S6: fire-and-forget emitters for the lineup / scheduling-poll
 * lifecycle. Same contract as `fireMatchEnteredScheduling`: call AFTER the
 * write commits and OUTSIDE any transaction; a throwing listener is logged,
 * never rethrown, so it can't undo or 500 a write that already landed.
 */
import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import {
  LINEUP_LIFECYCLE_EVENTS,
  type LineupCreatedPayload,
  type LineupStatusChangedPayload,
  type PollCancelledPayload,
  type PollLockedInPayload,
  type PollOpenedPayload,
  type PollVotedPayload,
} from './lineup-events.constants';
import { LINEUP_MATCH_EVENTS } from './lineups-scheduling-hook.helpers';

const logger = new Logger('LineupLifecycleEmit');

/** Event names already warned about for a missing bus (warn once each). */
const warnedMissingBus = new Set<string>();

/**
 * Emit `name`, swallowing (and logging) any listener failure. The bus is
 * optional on four services (`@Optional()` keeps positional spec
 * construction compiling); a missing bus in a real module graph would be
 * silent, so it warns once per event name.
 */
function safeEmit(
  events: EventEmitter2 | undefined,
  name: string,
  payload: object,
): void {
  if (!events) {
    if (!warnedMissingBus.has(name)) {
      warnedMissingBus.add(name);
      logger.warn(`No EventEmitter2 wired — ${name} not emitted`);
    }
    return;
  }
  try {
    events.emit(name, payload);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to emit ${name}: ${msg}`);
  }
}

/** A lineup row was inserted. */
export function emitLineupCreated(
  events: EventEmitter2 | undefined,
  payload: LineupCreatedPayload,
): void {
  safeEmit(events, LINEUP_LIFECYCLE_EVENTS.CREATED, payload);
}

/** A lineup's status changed; a same-status "transition" emits nothing. */
export function emitLineupStatusChanged(
  events: EventEmitter2 | undefined,
  payload: LineupStatusChangedPayload,
): void {
  if (payload.from === payload.to) return;
  safeEmit(events, LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED, payload);
}

/** A scheduling-poll slot tap committed. */
export function emitPollVoted(
  events: EventEmitter2 | undefined,
  payload: PollVotedPayload,
): void {
  safeEmit(events, LINEUP_MATCH_EVENTS.POLL_VOTED, payload);
}

/** {@link emitPollVoted} from the match row the vote path already loaded. */
export function emitPollVotedFor(
  events: EventEmitter2 | undefined,
  match: { id: number; lineupId: number },
  userId: number,
  stance: PollVotedPayload['stance'],
): void {
  emitPollVoted(events, {
    matchId: match.id,
    lineupId: match.lineupId,
    userId,
    stance,
  });
}

/** A scheduling poll locked in (match → `scheduled`). */
export function emitPollLockedIn(
  events: EventEmitter2 | undefined,
  payload: PollLockedInPayload,
): void {
  safeEmit(events, LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, payload);
}

/** A scheduling poll was cancelled (match → `archived`). */
export function emitPollCancelled(
  events: EventEmitter2 | undefined,
  payload: PollCancelledPayload,
): void {
  safeEmit(events, LINEUP_MATCH_EVENTS.POLL_CANCELLED, payload);
}

/** A standalone scheduling poll was created (match → `scheduling`). */
export function emitPollOpened(
  events: EventEmitter2 | undefined,
  payload: PollOpenedPayload,
): void {
  safeEmit(events, LINEUP_MATCH_EVENTS.POLL_OPENED, payload);
}

/**
 * A standalone poll's carrier lineup was archived by its lock-in. The carrier
 * is inserted `decided` and is only ever archived once (the match CAS gates
 * it), so the edge is always `decided → archived`.
 */
export function emitStandaloneLineupArchived(
  events: EventEmitter2 | undefined,
  lineupId: number,
): void {
  emitLineupStatusChanged(events, {
    lineupId,
    from: 'decided',
    to: 'archived',
    standalone: true,
  });
}

/** The row fields a lineup payload carries when the emitter has the row. */
export function lineupSubjectFields(row: {
  visibility: LineupCreatedPayload['visibility'];
  guildId: number | null;
  phaseDurationOverride: { standalone?: boolean } | null;
}): Pick<LineupCreatedPayload, 'visibility' | 'guildId' | 'standalone'> {
  return {
    visibility: row.visibility,
    guildId: row.guildId,
    standalone: row.phaseDurationOverride?.standalone === true,
  };
}
