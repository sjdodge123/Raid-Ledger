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

export interface SchedulingCancelActionProps {
  lineupId: number;
  matchId: number;
  readOnly: boolean;
}

/**
 * Operator-only Cancel Poll affordance. ROK-1219: opens a second-confirm
 * modal (optional reason) instead of cancelling on a single click; confirming
 * mutates then navigates to /events. See file-level docstring.
 */
export function SchedulingCancelAction(
  props: SchedulingCancelActionProps,
): JSX.Element | null {
  const { lineupId, matchId, readOnly } = props;
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
  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        disabled={cancelPoll.isPending}
        className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-red-400/90 border border-red-400/30 rounded hover:bg-red-400/10 transition-colors disabled:opacity-50 whitespace-nowrap"
      >
        {cancelPoll.isPending ? 'Cancelling…' : 'Cancel Poll'}
      </button>
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
