import { useQuery } from '@tanstack/react-query';
import { useAuth } from './use-auth';
import { getMyPreferences } from '../lib/api-client';
import { useThemeStore } from '../stores/theme-store';
import { useTimezoneStore } from '../stores/timezone-store';
import { useCalendarViewStore } from '../stores/calendar-view-store';

/**
 * Syncs theme, timezone, and calendar view preferences from server on login.
 * Server is source of truth — overrides localStorage if different.
 * Fires once per session (staleTime: Infinity).
 */
export function useThemeSync() {
    const { isAuthenticated } = useAuth();
    const setTheme = useThemeStore((s) => s.setTheme);
    const setTimezone = useTimezoneStore((s) => s.setTimezone);
    const setViewPref = useCalendarViewStore((s) => s.setViewPref);

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
            if (typeof prefs.calendarView === 'string') {
                const v = prefs.calendarView;
                if (v === 'week' || v === 'month' || v === 'day') setViewPref(v);
            }
            return prefs;
        },
        enabled: isAuthenticated,
        staleTime: Infinity,
    });
}
