/**
 * Deep link into the game page's notification panel (ROK-1797): the Discord
 * DM's "Adjust notifications" button lands on `/games/:id?action=notifications&notif=<id>`.
 *
 * `?notif=` is marked read at once; `?action=notifications` opens the panel
 * once the viewer's mute state has loaded. Both params are stripped in ONE
 * `setSearchParams` per pass. react-router hands a functional updater the
 * `searchParams` captured at render, so two hooks each stripping their own
 * param in the same tick would each re-add the other's — the reason this
 * replaces `useNotifReadSync` on this page instead of running beside it.
 */
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNotifications } from '../../hooks/use-notifications';

export const NOTIFY_ACTION = 'notifications';

export function useGameNotifyDeepLink(ready: boolean, openPanel: () => void): void {
    const [searchParams, setSearchParams] = useSearchParams();
    const { markRead } = useNotifications();

    useEffect(() => {
        const notifId = searchParams.get('notif');
        const opens = ready && searchParams.get('action') === NOTIFY_ACTION;
        if (!notifId && !opens) return;
        if (notifId) markRead(notifId);
        if (opens) openPanel();
        const next = new URLSearchParams(searchParams);
        if (notifId) next.delete('notif');
        if (opens) next.delete('action');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams, markRead, ready, openPanel]);
}
