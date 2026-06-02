/**
 * Operator/creator "Cancel Poll" affordance for the ROK-1300 Scheduling
 * composite. Re-homed from the legacy poll-page chrome into the composite so
 * the single hero owns the page top. Gated by `isOperatorOrAdmin` (the same
 * gate the legacy `PollHeader` used) and hidden in read-only polls.
 */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCancelSchedulePoll } from '../../../hooks/use-scheduling';
import { useAuth, isOperatorOrAdmin } from '../../../hooks/use-auth';

export interface SchedulingCancelActionProps {
  lineupId: number;
  matchId: number;
  readOnly: boolean;
}

/** Operator-only Cancel Poll button — see file-level docstring. */
export function SchedulingCancelAction(
  props: SchedulingCancelActionProps,
): JSX.Element | null {
  const { lineupId, matchId, readOnly } = props;
  const { user } = useAuth();
  const navigate = useNavigate();
  const cancelPoll = useCancelSchedulePoll();
  if (!isOperatorOrAdmin(user) || readOnly) return null;
  return (
    <button
      type="button"
      onClick={() =>
        cancelPoll.mutate(
          { lineupId, matchId },
          { onSuccess: () => navigate('/events') },
        )
      }
      disabled={cancelPoll.isPending}
      className="px-3 py-1.5 text-xs font-medium text-red-400 border border-red-400/30 rounded-lg hover:bg-red-400/10 transition-colors disabled:opacity-50"
    >
      {cancelPoll.isPending ? 'Cancelling...' : 'Cancel Poll'}
    </button>
  );
}
