import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../../lib/toast';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Textarea } from '../ui/textarea';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
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

type HandlerArgs = Pick<CancelEventModalProps, 'eventId' | 'eventTitle' | 'gameId' | 'onClose' | 'initialReason'>;

/**
 * The reason starts from `initialReason` once per mount. CancelModalSection
 * unmounts the modal while it is hidden, so every open starts fresh — and a
 * reason the user cleared is never refilled (the old render-time set did).
 * Success paths close directly; only the dismiss paths go through the guard.
 */
function useCancelHandlers({ eventId, eventTitle, gameId, onClose, initialReason }: HandlerArgs) {
    const [reason, setReason] = useState(initialReason ?? '');
    const cancelEvent = useCancelEvent(eventId);
    const createPoll = useCreateSchedulingPoll();
    const navigate = useNavigate();
    const closeGuard = useDirtyCloseGuard(reason !== (initialReason ?? ''), onClose);

    const handleConfirm = async () => {
        try {
            await cancelEvent.mutateAsync(reason || undefined);
            toast.success('Event cancelled', { description: `"${eventTitle}" has been cancelled.` });
            onClose();
        } catch (err) {
            toast.error('Failed to cancel event', { description: err instanceof Error ? err.message : 'Please try again.' });
        }
    };

    const handleConvertToPoll = async () => {
        if (!gameId) return;
        try {
            const poll = await createPoll.mutateAsync({ gameId, linkedEventId: eventId, durationHours: 72 });
            onClose();
            navigate(`/community-lineup/${poll.lineupId}/schedule/${poll.id}`);
        } catch { /* Error toast handled by mutation */ }
    };

    return { reason, setReason, cancelEvent, createPoll, closeGuard, handleConfirm, handleConvertToPoll, canConvert: !!gameId };
}

type CancelHandlers = ReturnType<typeof useCancelHandlers>;

function OrDivider(): JSX.Element {
    return (
        <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-edge" />
            <span className="text-xs text-muted">or</span>
            <div className="flex-1 border-t border-edge" />
        </div>
    );
}

/** The pinned footer (ROK-1655 AC2): Keep / Cancel, then the Convert to Poll alternative. */
function CancelFooter({ h }: { h: CancelHandlers }): JSX.Element {
    const cancelPending = h.cancelEvent.isPending;
    const convertPending = h.createPoll.isPending;
    return (
        <div className="flex w-full flex-col gap-3">
            <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={h.closeGuard.requestClose}>Keep Event</Button>
                <Button variant="destructive" size="sm" loading={cancelPending} loadingLabel="Cancelling..."
                    disabled={convertPending} onClick={() => { void h.handleConfirm(); }}>
                    Cancel Event
                </Button>
            </div>
            <OrDivider />
            <Button variant="primary" fullWidth loading={convertPending} loadingLabel="Creating poll..."
                disabled={cancelPending || !h.canConvert} onClick={() => { void h.handleConvertToPoll(); }}>
                Convert to Poll
            </Button>
            <p className="-mt-1 text-center text-xs text-muted">Don&apos;t cancel — let your community vote on a new time instead</p>
        </div>
    );
}

/**
 * Confirmation modal for cancelling an event (ROK-374). A typed reason is a
 * draft: Escape, the backdrop, × and Keep Event ask before dropping it (ROK-1655).
 */
export function CancelEventModal({ isOpen, onClose, eventId, eventTitle, signupCount, gameId, initialReason }: CancelEventModalProps) {
    const h = useCancelHandlers({ eventId, eventTitle, gameId, onClose, initialReason });

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Cancel Event" closeGuard={h.closeGuard} footer={<CancelFooter h={h} />}>
            <div className="space-y-4">
                <p className="text-sm text-foreground">
                    Are you sure you want to cancel <span className="font-semibold">{eventTitle}</span>?
                </p>
                {signupCount > 0 && (
                    <p className="text-sm text-warning">
                        All {signupCount} signed-up member{signupCount !== 1 ? 's' : ''} will be notified.
                    </p>
                )}
                <Field label="Reason (optional)" id="cancel-reason">
                    <Textarea value={h.reason} onChange={(e) => h.setReason(e.target.value)} showCount maxLength={500}
                        rows={3} resize="none" placeholder="e.g. Not enough signups, scheduling conflict..." />
                </Field>
            </div>
        </Modal>
    );
}
