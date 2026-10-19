import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNotifications } from './use-notifications';
import { isUuid } from '../lib/is-uuid';

/**
 * Hook to handle ?notif={id} query param from Discord DM URL buttons (ROK-180 AC-4).
 * When a user clicks a "View Event" or similar button in a Discord DM,
 * the URL includes a notif query param. This hook marks that notification
 * as read on page load and cleans up the query param.
 *
 * ROK-1845: only a UUID is marked read — the value comes from a link anyone
 * can share, and it ends up in a Bearer-authenticated POST path. Any value is
 * still stripped from the address bar.
 */
export function useNotifReadSync() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { markRead } = useNotifications();

    useEffect(() => {
        const notifId = searchParams.get('notif');
        if (!notifId) return;

        if (isUuid(notifId)) markRead(notifId);

        // Remove the query param to clean up the URL
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('notif');
        setSearchParams(newParams, { replace: true });
    }, [searchParams, setSearchParams, markRead]);
}
