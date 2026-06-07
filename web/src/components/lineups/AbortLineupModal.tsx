/**
 * AbortLineupModal (ROK-1062).
 * Confirms the destructive abort action with an optional reason.
 * Opened from AbortLineupButton on the lineup detail page.
 */
import { useState, type JSX } from 'react';
import { Modal } from '../ui/modal';
import { useAbortLineup } from '../../hooks/use-lineups';
import { toast } from '../../lib/toast';
import { ReasonField } from './shared/ReasonField';
import { DestructiveModalFooter } from './shared/DestructiveModalFooter';

interface Props {
    lineupId: number;
    onClose: () => void;
}

async function submitAbort(
    abort: ReturnType<typeof useAbortLineup>,
    lineupId: number,
    reason: string,
    onClose: () => void,
): Promise<void> {
    const trimmed = reason.trim();
    try {
        await abort.mutateAsync({
            lineupId,
            body: { reason: trimmed === '' ? null : trimmed },
        });
        toast.success('Lineup aborted.');
        onClose();
    } catch (err) {
        toast.error(
            err instanceof Error ? err.message : 'Failed to abort lineup',
        );
    }
}

export function AbortLineupModal({ lineupId, onClose }: Props): JSX.Element {
    const [reason, setReason] = useState('');
    const abort = useAbortLineup();
    return (
        <Modal isOpen={true} onClose={onClose} title="Abort lineup?">
            <div className="space-y-4">
                <p className="text-sm font-medium text-rose-400">
                    This cannot be undone.
                </p>
                <ReasonField
                    id="abort-lineup-reason"
                    value={reason}
                    onChange={setReason}
                    placeholder="Why is this lineup being aborted?"
                />
                <DestructiveModalFooter
                    onCancel={onClose}
                    onConfirm={() =>
                        void submitAbort(abort, lineupId, reason, onClose)
                    }
                    isPending={abort.isPending}
                    confirmLabel="Abort Lineup"
                    pendingLabel="Aborting..."
                />
            </div>
        </Modal>
    );
}
