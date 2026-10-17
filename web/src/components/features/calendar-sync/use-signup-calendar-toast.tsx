/**
 * The sign-up toast (ROK-1596 S3). With a connected calendar that receives
 * events, it reads "Signed up. **Added to Google Calendar**" with an Undo that
 * removes only that one calendar copy, never the sign-up (Q4). Without one —
 * or for a bench placement — it is the existing sign-up toast, unchanged.
 */
import { useCallback } from 'react';
import { toast } from '../../../lib/toast';
import { getSignupToast } from '../../../pages/event-detail/signup-toast.helpers';
import { useCalendarsOverview, useUndoCalendarCopy } from '../../../hooks/use-calendar-sync';
import { UNDO_HIT_AREA_CLASS } from '../game-time/away/use-absence-section';
import { EVENT_CALENDAR_COPY as C, PROVIDER_CALENDAR_NAME } from './calendar-sync.copy';

/** The provider whose calendar gets this user's events, when the kill switch is on (any non-`disconnecting` status, like the server). */
function useWriteProvider() {
    const { data } = useCalendarsOverview();
    if (!data?.enabled) return null;
    return data.connections.find((c) => c.status !== 'disconnecting' && c.write.enabled)?.provider ?? null;
}

/** Returns `announce(assignedSlot)` — call it after a sign-up succeeds. */
export function useSignupCalendarToast(eventId: number) {
    const provider = useWriteProvider();
    const undo = useUndoCalendarCopy(eventId);
    const { mutate } = undo;
    return useCallback((assignedSlot: string | null | undefined) => {
        const t = getSignupToast(assignedSlot);
        if (!provider || assignedSlot === 'bench') { toast.success(t.title, { description: t.description }); return; }
        const onUndo = () => mutate(undefined, { onError: () => toast.error(C.undoFailed) });
        toast.success(
            <span>{C.toastSignedUp} <strong>{C.toastAdded(PROVIDER_CALENDAR_NAME[provider])}</strong></span>,
            { action: { label: C.undo, onClick: onUndo }, classNames: { actionButton: UNDO_HIT_AREA_CLASS } },
        );
    }, [provider, mutate]);
}
