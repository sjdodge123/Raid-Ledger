/**
 * CancelPollModal (ROK-1219 / F-38).
 * Second-confirm modal for the operator "Cancel Poll" action on a standalone
 * scheduling poll. Mirrors the ROK-1062 abort modal via shared sub-components
 * (ReasonField + DestructiveModalFooter). Confirming dispatches the cancel
 * with a trimmed reason (null when empty); on success the caller navigates.
 */
import { useState, type JSX } from 'react';
import { Modal } from '../../ui/modal';
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

export function CancelPollModal({
    onClose,
    onConfirm,
    isPending,
}: CancelPollModalProps): JSX.Element {
    const [reason, setReason] = useState('');
    const submit = (): void => {
        const trimmed = reason.trim();
        onConfirm(trimmed === '' ? null : trimmed);
    };
    return (
        <Modal isOpen={true} onClose={onClose} title="Cancel poll?">
            <div className="space-y-4">
                <p className="text-sm font-medium text-rose-400">
                    {CONFIRM_COPY}
                </p>
                <ReasonField
                    id="cancel-poll-reason"
                    value={reason}
                    onChange={setReason}
                    placeholder="Why is this poll being cancelled?"
                />
                <DestructiveModalFooter
                    onCancel={onClose}
                    onConfirm={submit}
                    isPending={isPending}
                    confirmLabel="Cancel Poll"
                    pendingLabel="Cancelling…"
                />
            </div>
        </Modal>
    );
}
