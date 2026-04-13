import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../../lib/toast';
import { Modal } from '../ui/modal';
import { useCancelEvent } from '../../hooks/use-events';
import { useCreateSchedulingPoll } from '../../hooks/use-standalone-poll';

interface CancelEventModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventId: number;
    eventTitle: string;
    signupCount: number;
    gameId?: number;
    /** ROK-536: Pre-populate reason from deep-link query param. */
    initialReason?: string;
}

function useCancelHandlers({ eventId, eventTitle, gameId, onClose }: { eventId: number; eventTitle: string; gameId?: number; onClose: () => void }) {
    const [reason, setReason] = useState('');
    const cancelEvent = useCancelEvent(eventId);
    const createPoll = useCreateSchedulingPoll();
    const navigate = useNavigate();

    const handleClose = () => { setReason(''); onClose(); };

    const handleConfirm = async () => {
        try {
            await cancelEvent.mutateAsync(reason || undefined);
            toast.success('Event cancelled', { description: `"${eventTitle}" has been cancelled.` });
            setReason(''); onClose();
        } catch (err) {
            toast.error('Failed to cancel event', { description: err instanceof Error ? err.message : 'Please try again.' });
        }
    };

    const handleConvertToPoll = async () => {
        if (!gameId) return;
        try {
            const poll = await createPoll.mutateAsync({ gameId, linkedEventId: eventId, durationHours: 72 });
            setReason(''); onClose();
            navigate(`/community-lineup/${poll.lineupId}/schedule/${poll.id}`);
        } catch { /* Error toast handled by mutation */ }
    };

    return { reason, setReason, cancelEvent, createPoll, handleClose, handleConfirm, handleConvertToPoll, canConvert: !!gameId };
}

function ReasonInput({ reason, onChange }: { reason: string; onChange: (v: string) => void }) {
    return (
        <div>
            <label htmlFor="cancel-reason" className="block text-xs text-muted mb-1">Reason (optional)</label>
            <textarea id="cancel-reason" value={reason} onChange={(e) => onChange(e.target.value)}
                maxLength={500} rows={3} placeholder="e.g. Not enough signups, scheduling conflict..."
                className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-dim focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
            <p className="text-xs text-dim mt-1 text-right">{reason.length}/500</p>
        </div>
    );
}

function ActionButtons({ onClose, onConfirm, cancelPending, convertPending }: {
    onClose: () => void; onConfirm: () => void; cancelPending: boolean; convertPending: boolean;
}) {
    return (
        <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="btn btn-secondary btn-sm">Keep Event</button>
            <button onClick={onConfirm} disabled={cancelPending || convertPending} className="btn btn-danger btn-sm">
                {cancelPending ? 'Cancelling...' : 'Cancel Event'}
            </button>
        </div>
    );
}

function ConvertToPollSection({ onConvert, isPending, cancelPending, disabled }: {
    onConvert: () => void; isPending: boolean; cancelPending: boolean; disabled: boolean;
}) {
    return (
        <>
            <div className="flex items-center gap-3 pt-1">
                <div className="flex-1 border-t border-edge" />
                <span className="text-xs text-muted">or</span>
                <div className="flex-1 border-t border-edge" />
            </div>
            <button onClick={onConvert} disabled={isPending || cancelPending || disabled}
                className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-medium text-white transition-colors">
                {isPending ? 'Creating poll...' : 'Convert to Poll'}
            </button>
            <p className="text-xs text-muted text-center -mt-1">Don't cancel — let your community vote on a new time instead</p>
        </>
    );
}

/**
 * Confirmation modal for cancelling an event (ROK-374).
 */
export function CancelEventModal({ isOpen, onClose, eventId, eventTitle, signupCount, gameId, initialReason }: CancelEventModalProps) {
    const h = useCancelHandlers({ eventId, eventTitle, gameId, onClose });

    // Initialize reason from prop
    if (initialReason && !h.reason) h.setReason(initialReason);

    return (
        <Modal isOpen={isOpen} onClose={h.handleClose} title="Cancel Event">
            <div className="space-y-4">
                <p className="text-sm text-foreground">
                    Are you sure you want to cancel <span className="font-semibold">{eventTitle}</span>?
                </p>
                {signupCount > 0 && (
                    <p className="text-sm text-amber-400">
                        All {signupCount} signed-up member{signupCount !== 1 ? 's' : ''} will be notified.
                    </p>
                )}
                <ReasonInput reason={h.reason} onChange={h.setReason} />
                <ActionButtons onClose={h.handleClose} onConfirm={h.handleConfirm}
                    cancelPending={h.cancelEvent.isPending} convertPending={h.createPoll.isPending} />
                <ConvertToPollSection onConvert={h.handleConvertToPoll}
                    isPending={h.createPoll.isPending} cancelPending={h.cancelEvent.isPending} disabled={!h.canConvert} />
            </div>
        </Modal>
    );
}
