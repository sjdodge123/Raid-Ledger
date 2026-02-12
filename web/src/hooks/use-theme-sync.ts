import { useQuery } from '@tanstack/react-query';
import { useAuth } from './use-auth';
import { getMyPreferences } from '../lib/api-client';
import { useThemeStore } from '../stores/theme-store';
import type { ThemeModePreference } from '../stores/theme-store';
import { useTimezoneStore } from '../stores/timezone-store';
import { useCalendarViewStore } from '../stores/calendar-view-store';

const VALID_MODES: ThemeModePreference[] = ['light', 'dark', 'auto'];

/**
 * Syncs theme, timezone, and calendar view preferences from server on login.
 * Server is source of truth -- overrides localStorage if different.
 * Fires once per session (staleTime: Infinity).
 *
 * AC-6 backward compat: handles both legacy `theme` key and new
 * `themeMode`/`lightTheme`/`darkTheme` keys from the server.
 */
export function useThemeSync() {
    const { isAuthenticated } = useAuth();
    const setMode = useThemeStore((s) => s.setMode);
    const setLightTheme = useThemeStore((s) => s.setLightTheme);
    const setDarkTheme = useThemeStore((s) => s.setDarkTheme);
    const setThemeLegacy = useThemeStore((s) => s.setTheme);
    const setTimezone = useTimezoneStore((s) => s.setTimezone);
    const setViewPref = useCalendarViewStore((s) => s.setViewPref);

    useQuery({
        queryKey: ['user-preferences'],
        queryFn: async () => {
            const prefs = await getMyPreferences();

            // New three-key model
            if (typeof prefs.themeMode === 'string' && VALID_MODES.includes(prefs.themeMode as ThemeModePreference)) {
                setMode(prefs.themeMode as ThemeModePreference);
            }
            if (typeof prefs.lightTheme === 'string') {
                setLightTheme(prefs.lightTheme as string);
            }
            if (typeof prefs.darkTheme === 'string') {
                setDarkTheme(prefs.darkTheme as string);
            }

            // Legacy fallback: if server only has old `theme` key (no new keys yet)
            if (
                typeof prefs.theme === 'string' &&
                typeof prefs.themeMode !== 'string'
            ) {
                setThemeLegacy(prefs.theme as string);
            }

            if (typeof prefs.timezone === 'string') {
                setTimezone(prefs.timezone as string);
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
