/**
 * The OAuth callback lands on `/profile/integrations?connected=google`
 * or `?error=<code>` (ROK-1594; moved ROK-1780). Success is a toast (the result of an action
 * the user took, design-system §4.8); an error is kept for an inline banner,
 * because the user has to act on it. Both params are stripped once handled.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CALENDARS_COPY as C } from './calendar-sync.copy';

/** Fixed id, so a StrictMode double effect still shows ONE toast. */
const CONNECTED_TOAST_ID = 'calendar-connected';

const NO_EXTRA_PARAMS: readonly string[] = [];

/**
 * `extraParams`: more return params to strip in the SAME navigation (the wizard's `resume`,
 * ROK-2022). A second `setSearchParams` elsewhere would race this one. Pass a stable array.
 */
export function useCalendarOAuthFeedback(
    extraParams: readonly string[] = NO_EXTRA_PARAMS,
): { errorCode: string | null; dismissError: () => void } {
    const [params, setParams] = useSearchParams();
    const connected = params.get('connected');
    const error = params.get('error');
    const hasExtra = extraParams.some((key) => params.has(key));
    // The callback is a full page load, so the code is read once, on mount.
    const [errorCode, setErrorCode] = useState<string | null>(() => error);
    useEffect(() => {
        if (connected === null && error === null && !hasExtra) return;
        if (connected === 'google') toast.success(C.toastConnected, { id: CONNECTED_TOAST_ID });
        if (connected === 'microsoft') toast.success(C.microsoft.toastConnected, { id: CONNECTED_TOAST_ID });
        setParams((prev) => {
            const next = new URLSearchParams(prev);
            for (const key of ['connected', 'error', ...extraParams]) next.delete(key);
            return next;
        }, { replace: true });
    }, [connected, error, hasExtra, extraParams, setParams]);
    return { errorCode, dismissError: () => setErrorCode(null) };
}
