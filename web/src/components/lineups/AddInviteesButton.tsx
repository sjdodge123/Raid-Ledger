/**
 * Trigger + modal pair for adding invitees to an existing private lineup
 * (ROK-1065).
 *
 * Reuses the same `InviteeMultiSelect` input as the Start Lineup modal so
 * the UX is consistent. Only rendered by the parent (lineup detail page)
 * when the current viewer is the creator, an admin, or an operator.
 */
import { useState, type JSX } from 'react';
import { Modal } from '../ui/modal';
import { InviteeMultiSelect } from './InviteeMultiSelect';
import { useAddLineupInvitees } from '../../hooks/use-lineups';
import { toast } from '../../lib/toast';

export interface AddInviteesButtonProps {
  lineupId: number;
}

/** Render the "Invite more" button and its modal. */
export function AddInviteesButton({
  lineupId,
}: AddInviteesButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="add-invitees-button"
        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-muted hover:text-foreground rounded border border-edge/50 hover:bg-overlay/50 transition-colors"
      >
        Invite more
      </button>
      {open && (
        <AddInviteesModal
          lineupId={lineupId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AddInviteesModal({
  lineupId,
  onClose,
}: {
  lineupId: number;
  onClose: () => void;
}): JSX.Element {
  const [userIds, setUserIds] = useState<number[]>([]);
  const addInvitees = useAddLineupInvitees();
  const canSubmit = userIds.length > 0 && !addInvitees.isPending;

  async function handleSubmit(): Promise<void> {
    try {
      await addInvitees.mutateAsync({ lineupId, userIds });
      toast.success(`Added ${userIds.length} invitee(s)`);
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to add invitees',
      );
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Add Invitees">
      <div className="space-y-4">
        <InviteeMultiSelect value={userIds} onChange={setUserIds} />
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
            className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {addInvitees.isPending ? 'Adding...' : 'Add Invitees'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
