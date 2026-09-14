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

/** Body of the expired banner: what happened, then the next action. */
function ExpiredBody(): JSX.Element {
  return (
    <>
      <p className="mt-1 text-sm text-foreground">
        The deadline passed without a lock-in, so these times are no longer
        votable.
      </p>
      <p className="mt-1 text-xs text-secondary">
        Start a new poll from the game, or ask an organiser to re-run this one.
      </p>
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
      {pollStatus === 'closed' && <ExpiredBody />}
    </div>
  );
}
