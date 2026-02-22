import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../../lib/toast';
import { Modal } from '../ui/modal';
import { useCancelEvent } from '../../hooks/use-events';
import { useConvertEventToPlan } from '../../hooks/use-event-plans';

interface CancelEventModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventId: number;
    eventTitle: string;
    signupCount: number;
}

/**
 * Confirmation modal for cancelling an event (ROK-374).
 * Shows signup count warning, optional reason input, and a "Convert to Plan" option.
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
    const convertToPlan = useConvertEventToPlan();
    const navigate = useNavigate();

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

    const handleConvertToPlan = async () => {
        try {
            await convertToPlan.mutateAsync({
                eventId,
                options: { cancelOriginal: true },
            });
            setReason('');
            onClose();
            navigate('/events?tab=plans');
        } catch {
            // Error toast handled by the mutation's onError
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
                        disabled={cancelEvent.isPending || convertToPlan.isPending}
                        className="btn btn-danger btn-sm"
                    >
                        {cancelEvent.isPending ? 'Cancelling...' : 'Cancel Event'}
                    </button>
                </div>

                {/* Convert to Plan option */}
                <div className="flex items-center gap-3 pt-1">
                    <div className="flex-1 border-t border-edge" />
                    <span className="text-xs text-muted">or</span>
                    <div className="flex-1 border-t border-edge" />
                </div>

                <button
                    onClick={handleConvertToPlan}
                    disabled={convertToPlan.isPending || cancelEvent.isPending}
                    className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-medium text-white transition-colors"
                >
                    {convertToPlan.isPending ? 'Converting...' : 'Convert to Plan'}
                </button>
                <p className="text-xs text-muted text-center -mt-1">
                    Post a Discord poll so your community can vote on a new time
                </p>
            </div>
        </Modal>
    );
}
