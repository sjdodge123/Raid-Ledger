/**
 * Operator/creator "Cancel Poll" affordance for the ROK-1300 Scheduling
 * composite. Re-homed from the legacy poll-page chrome into the composite so
 * the single hero owns the page top. Gated by `isOperatorOrAdmin` (the same
 * gate the legacy `PollHeader` used) and hidden in read-only polls.
 */
import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCancelSchedulePoll } from '../../../hooks/use-scheduling';
import { useAuth, isOperatorOrAdmin } from '../../../hooks/use-auth';
import { CancelPollModal } from './CancelPollModal';
import { SCHEDULING_ACTION_BUTTON_DANGER } from './scheduling-action-button';
import { SchedulingSheetRow } from './scheduling-sheet-row';

export interface SchedulingCancelActionProps {
  lineupId: number;
  matchId: number;
  readOnly: boolean;
  /** ROK-1584: `row` draws the action inside the phone "Manage poll" sheet. */
  variant?: 'button' | 'row';
}

/**
 * Operator-only Cancel Poll affordance. ROK-1219: opens a second-confirm
 * modal (optional reason) instead of cancelling on a single click; confirming
 * mutates then navigates to /events. See file-level docstring.
 */
export function SchedulingCancelAction(
  props: SchedulingCancelActionProps,
): JSX.Element | null {
  const { lineupId, matchId, readOnly, variant = 'button' } = props;
  const { user } = useAuth();
  const navigate = useNavigate();
  const cancelPoll = useCancelSchedulePoll();
  const [isOpen, setIsOpen] = useState(false);
  if (!isOperatorOrAdmin(user) || readOnly) return null;
  const confirm = (reason: string | null): void => {
    cancelPoll.mutate(
      { lineupId, matchId, reason },
      { onSuccess: () => navigate('/events') },
    );
  };
  const label = cancelPoll.isPending ? 'Cancelling…' : 'Cancel Poll';
  const shortLabel = cancelPoll.isPending ? label : 'Cancel';
  return (
    <>
      {variant === 'row' ? (
        <SchedulingSheetRow
          title={label}
          onClick={() => setIsOpen(true)}
          disabled={cancelPoll.isPending}
          danger
        />
      ) : (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        disabled={cancelPoll.isPending}
        aria-label={label}
        className={SCHEDULING_ACTION_BUTTON_DANGER}
      >
        {/* ROK-1582: short on a phone (three equal columns at 375px), full
            from `sm`; the `aria-label` keeps the name stable either way. */}
        <span className="sm:hidden">{shortLabel}</span>
        <span className="hidden sm:inline">{label}</span>
      </button>
      )}
      {isOpen && (
        <CancelPollModal
          onClose={() => setIsOpen(false)}
          onConfirm={confirm}
          isPending={cancelPoll.isPending}
        />
      )}
    </>
  );
}
