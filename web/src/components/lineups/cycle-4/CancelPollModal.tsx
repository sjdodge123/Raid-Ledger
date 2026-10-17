/**
 * CancelPollModal (ROK-1219 / F-38).
 * Second-confirm modal for the operator "Cancel Poll" action on a standalone
 * scheduling poll. Mirrors the ROK-1062 abort modal via shared sub-components
 * (ReasonField + DestructiveModalFooter). Confirming dispatches the cancel
 * with a trimmed reason (null when empty); on success the caller navigates.
 * ROK-1655: Escape, backdrop, × and the explicit Cancel ask before discarding
 * a typed reason (whitespace-only is not dirty). Actions sit in the pinned footer.
 */
import { useState, type JSX } from 'react';
import { Modal } from '../../ui/modal';
import { useDirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
import { ReasonField } from '../shared/ReasonField';
import { DestructiveModalFooter } from '../shared/DestructiveModalFooter';

const CONFIRM_COPY =
    'Cancel this poll? Voters will be notified. This cannot be undone.';

interface CancelPollModalProps {
    onClose: () => void;
    /** Fire the cancel with the trimmed reason (null when empty). */
    onConfirm: (reason: string | null) => void;
    isPending: boolean;
}

function trimmedOrNull(reason: string): string | null {
    const trimmed = reason.trim();
    return trimmed === '' ? null : trimmed;
}

export function CancelPollModal({
    onClose,
    onConfirm,
    isPending,
}: CancelPollModalProps): JSX.Element {
    const [reason, setReason] = useState('');
    const guard = useDirtyCloseGuard(reason.trim() !== '', onClose);
    const footer = (
        <DestructiveModalFooter onCancel={guard.requestClose} onConfirm={() => onConfirm(trimmedOrNull(reason))}
            isPending={isPending} confirmLabel="Cancel Poll" pendingLabel="Cancelling…" />
    );
    return (
        <Modal isOpen={true} onClose={onClose} closeGuard={guard}
            title="Cancel poll?" footer={footer}>
            <div className="space-y-4">
                <p className="text-sm font-medium text-danger">
                    {CONFIRM_COPY}
                </p>
                <ReasonField
                    id="cancel-poll-reason"
                    value={reason}
                    onChange={setReason}
                    placeholder="Why is this poll being cancelled?"
                />
            </div>
        </Modal>
    );
}
