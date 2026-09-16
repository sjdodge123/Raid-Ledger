/**
 * Creator/operator "Add Participants" action for the scheduling toolbar
 * (ROK-1440).
 *
 * A poll's roster is otherwise derived — you join it by voting or via
 * bandwagon clustering — so a creator who knows two more people are playing
 * had no way to get their availability, and a poll whose `minVoteThreshold`
 * exceeds the derived roster could never reach its lock threshold.
 *
 * Gated exactly like the sibling Remind action (`canBypassThreshold` =
 * lineup creator OR admin/operator) and hidden in read-only polls. Reuses
 * `InviteeMultiSelect` so picking people is the same interaction as every
 * other member picker in the lineup flow.
 */
import { useState, type JSX } from 'react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { Modal } from '../../ui/modal';
import { InviteeMultiSelect } from '../InviteeMultiSelect';
import { useAddPollMembers } from '../../../hooks/use-scheduling';
import { useAuth } from '../../../hooks/use-auth';
import { canBypassThreshold } from '../../../pages/scheduling/threshold';
import { SCHEDULING_ACTION_BUTTON } from './scheduling-action-button';
import { SchedulingSheetRow } from './scheduling-sheet-row';

export interface SchedulingAddMembersActionProps {
  lineupId: number;
  matchId: number;
  match: MatchDetailResponseDto;
  readOnly: boolean;
  /**
   * ROK-1584: `row` draws the action as a 52px row of the phone "Manage poll"
   * sheet instead of a hero button. The mutation + modal are unchanged — only
   * the trigger's presentation differs.
   */
  variant?: 'button' | 'row';
}

/** Creator/operator-only Add Participants button — see file-level docstring. */
export function SchedulingAddMembersAction(
  props: SchedulingAddMembersActionProps,
): JSX.Element | null {
  const { lineupId, matchId, match, readOnly, variant = 'button' } = props;
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!canBypassThreshold(user, match) || readOnly) return null;
  return (
    <>
      {variant === 'row' ? (
        <SchedulingSheetRow
          title="Add Participants"
          subline="invite more people"
          onClick={() => setOpen(true)}
          testId="add-poll-members-button"
        />
      ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="add-poll-members-button"
        aria-label="Add Participants"
        className={SCHEDULING_ACTION_BUTTON}
      >
        {/* ROK-1582: the phone row fits three equal buttons at 375px only with
            short labels; the `aria-label` keeps the full name for screen
            readers and for the role-name queries in tests. */}
        <span className="sm:hidden">Add</span>
        <span className="hidden sm:inline">Add Participants</span>
      </button>
      )}
      {open && (
        <AddMembersModal
          lineupId={lineupId}
          matchId={matchId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AddMembersModal({
  lineupId,
  matchId,
  onClose,
}: {
  lineupId: number;
  matchId: number;
  onClose: () => void;
}): JSX.Element {
  const [userIds, setUserIds] = useState<number[]>([]);
  const addMembers = useAddPollMembers();
  const canSubmit = userIds.length > 0 && !addMembers.isPending;

  async function handleSubmit(): Promise<void> {
    try {
      await addMembers.mutateAsync({ lineupId, matchId, userIds });
      onClose();
    } catch {
      // The mutation's onError already surfaced a toast; keep the modal open
      // so the picked selection isn't lost and the user can retry.
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Add Participants">
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Pull members into this poll so their availability counts toward
          locking a time. They&apos;ll be included in “Remind voters” until
          they vote.
        </p>
        <InviteeMultiSelect
          value={userIds}
          onChange={setUserIds}
          mode="public"
        />
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-secondary bg-panel border border-edge rounded-lg hover:bg-overlay transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            data-testid="add-poll-members-submit"
            className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {addMembers.isPending ? 'Adding…' : 'Add Participants'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
