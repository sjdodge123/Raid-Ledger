import { useState } from 'react';
import { toast } from '../../lib/toast';
import { Modal } from '../ui/modal';
import { useCancelEvent } from '../../hooks/use-events';

interface CancelEventModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventId: number;
    eventTitle: string;
    signupCount: number;
}

/**
 * Confirmation modal for cancelling an event (ROK-374).
 * Shows signup count warning and optional reason input.
 */
export function CancelEventModal({
    isOpen,
    onClose,
    eventId,
    eventTitle,
    signupCount,
}: CancelEventModalProps) {
    const [reason, setReason] = useState('');
    const cancelEvent = useCancelEvent(eventId);

    const handleConfirm = async () => {
        try {
            await cancelEvent.mutateAsync(reason || undefined);
            toast.success('Event cancelled', {
                description: `"${eventTitle}" has been cancelled.`,
            });
            setReason('');
            onClose();
        } catch (err) {
            toast.error('Failed to cancel event', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    const handleClose = () => {
        setReason('');
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Cancel Event">
            <div className="space-y-4">
                <p className="text-sm text-foreground">
                    Are you sure you want to cancel <span className="font-semibold">{eventTitle}</span>?
                </p>

                {signupCount > 0 && (
                    <p className="text-sm text-amber-400">
                        All {signupCount} signed-up member{signupCount !== 1 ? 's' : ''} will be notified.
                    </p>
                )}

                <div>
                    <label htmlFor="cancel-reason" className="block text-xs text-muted mb-1">
                        Reason (optional)
                    </label>
                    <textarea
                        id="cancel-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={500}
                        rows={3}
                        placeholder="e.g. Not enough signups, scheduling conflict..."
                        className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-dim focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                    <p className="text-xs text-dim mt-1 text-right">{reason.length}/500</p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <button
                        onClick={handleClose}
                        className="btn btn-secondary btn-sm"
                    >
                        Keep Event
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={cancelEvent.isPending}
                        className="btn btn-danger btn-sm"
                    >
                        {cancelEvent.isPending ? 'Cancelling...' : 'Cancel Event'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
