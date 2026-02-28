import { useCallback } from 'react';
import { API_BASE_URL } from '../lib/config';
import { toast } from '../lib/toast';

/**
 * Returns a stable callback that initiates the Discord OAuth account-linking flow.
 * Reads the current JWT from localStorage and redirects the browser to the API's
 * Discord link endpoint with the token as a query parameter.
 */
export function useDiscordLink() {
    const linkDiscord = useCallback(() => {
        const token = localStorage.getItem('raid_ledger_token');
        if (!token) {
            toast.error('Please log in again to link Discord');
            return;
        }
        window.location.href = `${API_BASE_URL}/auth/discord/link?token=${encodeURIComponent(token)}`;
    }, []);

    return linkDiscord;
}
