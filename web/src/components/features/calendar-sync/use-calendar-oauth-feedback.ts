/**
 * The OAuth callback lands on `/profile/gaming/calendars?connected=google`
 * or `?error=<code>` (ROK-1594). Success is a toast (the result of an action
 * the user took, design-system §4.8); an error is kept for an inline banner,
 * because the user has to act on it. Both params are stripped once handled.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CALENDARS_COPY as C } from './calendar-sync.copy';

/** Fixed id, so a StrictMode double effect still shows ONE toast. */
const CONNECTED_TOAST_ID = 'calendar-connected';

export function useCalendarOAuthFeedback(): { errorCode: string | null; dismissError: () => void } {
    const [params, setParams] = useSearchParams();
    const connected = params.get('connected');
    const error = params.get('error');
    // The callback is a full page load, so the code is read once, on mount.
    const [errorCode, setErrorCode] = useState<string | null>(() => error);
    useEffect(() => {
        if (connected === null && error === null) return;
        if (connected === 'google') toast.success(C.toastConnected, { id: CONNECTED_TOAST_ID });
        setParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('connected');
            next.delete('error');
            return next;
        }, { replace: true });
    }, [connected, error, setParams]);
    return { errorCode, dismissError: () => setErrorCode(null) };
}
