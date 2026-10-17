import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNotifications } from './use-notifications';

/**
 * Hook to handle ?notif={id} query param from Discord DM URL buttons (ROK-180 AC-4).
 * When a user clicks a "View Event" or similar button in a Discord DM,
 * the URL includes a notif query param. This hook marks that notification
 * as read on page load and cleans up the query param.
 */
export function useNotifReadSync() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { markRead } = useNotifications();

    useEffect(() => {
        const notifId = searchParams.get('notif');
        if (!notifId) return;

        // Mark the notification as read
        markRead(notifId);

        // Remove the query param to clean up the URL
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('notif');
        setSearchParams(newParams, { replace: true });
    }, [searchParams, setSearchParams, markRead]);
}
