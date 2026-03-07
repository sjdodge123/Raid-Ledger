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
    /** ROK-536: Pre-populate reason from deep-link query param. */
    initialReason?: string;
}

function useCancelHandlers({ eventId, eventTitle, onClose }: { eventId: number; eventTitle: string; onClose: () => void }) {
    const [reason, setReason] = useState('');
    const cancelEvent = useCancelEvent(eventId);
    const convertToPlan = useConvertEventToPlan();
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

    const handleConvertToPlan = async () => {
        try {
            await convertToPlan.mutateAsync({ eventId, options: { cancelOriginal: true } });
            setReason(''); onClose(); navigate('/events?tab=plans');
        } catch { /* Error toast handled by mutation */ }
    };

    return { reason, setReason, cancelEvent, convertToPlan, handleClose, handleConfirm, handleConvertToPlan };
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

function ConvertToPlanSection({ onConvert, isPending, cancelPending }: {
    onConvert: () => void; isPending: boolean; cancelPending: boolean;
}) {
    return (
        <>
            <div className="flex items-center gap-3 pt-1">
                <div className="flex-1 border-t border-edge" />
                <span className="text-xs text-muted">or</span>
                <div className="flex-1 border-t border-edge" />
            </div>
            <button onClick={onConvert} disabled={isPending || cancelPending}
                className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-medium text-white transition-colors">
                {isPending ? 'Converting...' : 'Convert to Plan'}
            </button>
            <p className="text-xs text-muted text-center -mt-1">Post a Discord poll so your community can vote on a new time</p>
        </>
    );
}

/**
 * Confirmation modal for cancelling an event (ROK-374).
 */
export function CancelEventModal({ isOpen, onClose, eventId, eventTitle, signupCount, initialReason }: CancelEventModalProps) {
    const h = useCancelHandlers({ eventId, eventTitle, onClose });

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
                    cancelPending={h.cancelEvent.isPending} convertPending={h.convertToPlan.isPending} />
                <ConvertToPlanSection onConvert={h.handleConvertToPlan}
                    isPending={h.convertToPlan.isPending} cancelPending={h.cancelEvent.isPending} />
            </div>
        </Modal>
    );
}
