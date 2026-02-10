import { useQuery } from '@tanstack/react-query';
import { useAuth } from './use-auth';
import { getMyPreferences } from '../lib/api-client';
import { useThemeStore } from '../stores/theme-store';

/**
 * Syncs theme preference from server on login.
 * Server is source of truth — overrides localStorage if different.
 * Fires once per session (staleTime: Infinity).
 */
export function useThemeSync() {
    const { isAuthenticated } = useAuth();
    const setTheme = useThemeStore((s) => s.setTheme);

    useQuery({
        queryKey: ['user-preferences'],
        queryFn: async () => {
            const prefs = await getMyPreferences();
            if (typeof prefs.theme === 'string') {
                setTheme(prefs.theme);
            }
            return prefs;
        },
        enabled: isAuthenticated,
        staleTime: Infinity,
    });
}
