import { useQuery } from '@tanstack/react-query';
import { useAuth } from './use-auth';
import { getMyPreferences } from '../lib/api-client';
import { useThemeStore } from '../stores/theme-store';
import { useTimezoneStore } from '../stores/timezone-store';

/**
 * Syncs theme and timezone preferences from server on login.
 * Server is source of truth — overrides localStorage if different.
 * Fires once per session (staleTime: Infinity).
 */
export function useThemeSync() {
    const { isAuthenticated } = useAuth();
    const setTheme = useThemeStore((s) => s.setTheme);
    const setTimezone = useTimezoneStore((s) => s.setTimezone);

    useQuery({
        queryKey: ['user-preferences'],
        queryFn: async () => {
            const prefs = await getMyPreferences();
            if (typeof prefs.theme === 'string') {
                setTheme(prefs.theme);
            }
            if (typeof prefs.timezone === 'string') {
                setTimezone(prefs.timezone);
            }
            return prefs;
        },
        enabled: isAuthenticated,
        staleTime: Infinity,
    });
}
