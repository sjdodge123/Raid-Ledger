/**
 * Terminal-state banner for the scheduling poll (ROK-1545 / ROK-1540 P1-3).
 *
 * Replaces the single amber "This poll is read-only. Voting is closed." that
 * covered lock-in, cancellation and expiry alike (audit F-01/F-02/F-04) with
 * three banners that each say what actually happened:
 *   - locked in → the winning time + a link to the created event
 *   - cancelled → visually distinct, carrying the operator's reason
 *   - expired  → "the deadline passed without a lock-in" + the next action
 *
 * It sits BELOW the kept poll header (operator ruling 2026-09-13) and keeps
 * `data-testid="read-only-banner"`, which the shipped smoke specs resolve.
 * `role="status"` so a state change is announced rather than silently
 * repainting (P1-4 wants this across the surface; it is free here).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { formatSlotTime } from './scheduling-slot-time';

/** The four-state lifecycle the server derives (`pollStatus`). */
export type SchedulingPollStatus = 'open' | 'locked_in' | 'cancelled' | 'closed';

export interface SchedulingTerminalBannerProps {
  pollStatus: SchedulingPollStatus;
  /** ISO start time the lock-in selected. */
  lockedInTime: string | null;
  /** The operator's cancellation reason, when one was given. */
  cancelReason: string | null;
  /** The event a lock-in produced, for the "Open the event" link. */
  linkedEventId: number | null;
  /**
   * ROK-1610: on an EXPIRED poll the organiser may still finish it at a time
   * its members already voted for. The label of that slot, or null when there
   * is no such action (a member is looking, or every slot has passed) — then
   * the expired body keeps its "start a new poll" copy.
   */
  lockInLabel?: string | null;
  /** ROK-1610: open the confirm for the slot `lockInLabel` names. */
  onLockIn?: () => void;
  /**
   * Review fix: the poll is `closed` because every proposed time has passed,
   * NOT because the deadline ran out — suggesting is still open, so the copy
   * matches the Discord card's "suggest a new time or start a new poll"
   * instead of telling the reader the deadline passed.
   */
  timesPassed?: boolean;
}

/**
 * Tailwind tint per ending — cyan wins, red cancels, amber runs out.
 * `red`/`amber`/`cyan` are the hues whose `-500/10` + `-500/30-40` pair is
 * remapped for the light schemes (`docs/design-system.md` §4.7); `rose` is not.
 */
const TINTS: Record<Exclude<SchedulingPollStatus, 'open'>, string> = {
  locked_in: 'border-cyan-500/40 bg-cyan-500/10',
  cancelled: 'border-red-500/40 bg-red-500/10',
  closed: 'border-amber-500/30 bg-amber-500/10',
};

/** Eyebrow label per ending. */
const LABELS: Record<Exclude<SchedulingPollStatus, 'open'>, string> = {
  locked_in: 'Locked in',
  cancelled: 'Poll cancelled',
  closed: 'Poll expired',
};

/** Eyebrow text colour per ending. */
const LABEL_TINTS: Record<Exclude<SchedulingPollStatus, 'open'>, string> = {
  locked_in: 'text-cyan-300',
  cancelled: 'text-red-300',
  closed: 'text-amber-300',
};

/** Body of the locked-in banner: the winning time, then the event link. */
function LockedInBody(props: {
  lockedInTime: string | null;
  linkedEventId: number | null;
}): JSX.Element {
  const { lockedInTime, linkedEventId } = props;
  return (
    <>
      <p className="mt-0.5 text-lg font-semibold text-foreground">
        {lockedInTime ? formatSlotTime(lockedInTime).label : 'Time confirmed'}
      </p>
      <p className="mt-1 text-xs text-secondary">
        {linkedEventId ? (
          <Link
            data-testid="terminal-event-link"
            to={`/events/${linkedEventId}`}
            className="text-cyan-200 underline"
          >
            Open the event →
          </Link>
        ) : (
          'The poll is settled — nothing more to do here.'
        )}
      </p>
    </>
  );
}

/** Body of the cancelled banner: the operator's reason, then what follows. */
function CancelledBody({ reason }: { reason: string | null }): JSX.Element {
  return (
    <>
      <p className="mt-1 text-sm text-foreground">
        {reason ? `“${reason}”` : 'No reason was given.'}
      </p>
      <p className="mt-1 text-xs text-secondary">
        Nothing more to do here — you'll be notified if it re-runs.
      </p>
    </>
  );
}

/**
 * Body of the expired banner: what happened, then the next action.
 *
 * ROK-1610: when the organiser can still finish the poll (`lockInLabel` +
 * `onLockIn`), the next action is scheduling the time its voters already
 * picked — not re-polling. Everyone else keeps the original copy.
 */
function ExpiredBody(props: {
  lockInLabel: string | null;
  onLockIn?: () => void;
  timesPassed?: boolean;
}): JSX.Element {
  const { lockInLabel, onLockIn, timesPassed } = props;
  const canSchedule = lockInLabel !== null && onLockIn !== undefined;
  return (
    <>
      <p className="mt-1 text-sm text-foreground">
        {timesPassed
          ? 'Every proposed time has passed, so these times are no longer votable.'
          : 'The deadline passed without a lock-in, so these times are no longer votable.'}
      </p>
      <p
        data-testid="expired-banner-next-step"
        className="mt-1 text-xs text-secondary"
      >
        {canSchedule
          ? 'The members who voted already picked a time that is still ahead — schedule it without re-polling.'
          : timesPassed
            ? 'Suggest a new time below, or start a new poll from the game.'
            : 'Start a new poll from the game, or ask an organiser to re-run this one.'}
      </p>
      {canSchedule && (
        <button
          type="button"
          data-testid="expired-lock-in-action"
          onClick={onLockIn}
          className="mt-3 min-h-[44px] sm:min-h-[36px] w-full sm:w-auto inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-cyan-500 bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition-colors hover:bg-cyan-500 active:bg-cyan-700"
        >
          Schedule {lockInLabel}
        </button>
      )}
    </>
  );
}

/** Terminal-state banner — renders nothing while the poll is still open. */
export function SchedulingTerminalBanner(
  props: SchedulingTerminalBannerProps,
): JSX.Element | null {
  const { pollStatus, lockedInTime, cancelReason, linkedEventId } = props;
  if (pollStatus === 'open') return null;
  return (
    <div
      data-testid="read-only-banner"
      data-poll-status={pollStatus}
      role="status"
      className={`rounded-lg border p-3 ${TINTS[pollStatus]}`}
    >
      <p
        className={`text-xs uppercase tracking-wider ${LABEL_TINTS[pollStatus]}`}
      >
        {LABELS[pollStatus]}
      </p>
      {pollStatus === 'locked_in' && (
        <LockedInBody
          lockedInTime={lockedInTime}
          linkedEventId={linkedEventId}
        />
      )}
      {pollStatus === 'cancelled' && <CancelledBody reason={cancelReason} />}
      {pollStatus === 'closed' && (
        <ExpiredBody
          lockInLabel={props.lockInLabel ?? null}
          onLockIn={props.onLockIn}
          timesPassed={props.timesPassed}
        />
      )}
    </div>
  );
}
