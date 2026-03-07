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
interface PreferenceSetters {
    setMode: (mode: ThemeModePreference) => void;
    setLightTheme: (id: string) => void;
    setDarkTheme: (id: string) => void;
    setThemeLegacy: (id: string) => void;
    setTimezone: (tz: string) => void;
    setViewPref: (v: 'week' | 'month' | 'day') => void;
}

function applyServerPreferences(prefs: Record<string, unknown>, setters: PreferenceSetters) {
    if (typeof prefs.themeMode === 'string' && VALID_MODES.includes(prefs.themeMode as ThemeModePreference)) {
        setters.setMode(prefs.themeMode as ThemeModePreference);
    }
    if (typeof prefs.lightTheme === 'string') setters.setLightTheme(prefs.lightTheme as string);
    if (typeof prefs.darkTheme === 'string') setters.setDarkTheme(prefs.darkTheme as string);
    if (typeof prefs.theme === 'string' && typeof prefs.themeMode !== 'string') {
        setters.setThemeLegacy(prefs.theme as string);
    }
    if (typeof prefs.timezone === 'string') setters.setTimezone(prefs.timezone as string);
    if (typeof prefs.calendarView === 'string') {
        const v = prefs.calendarView;
        if (v === 'week' || v === 'month' || v === 'day') setters.setViewPref(v);
    }
}

export function useThemeSync() {
    const { isAuthenticated } = useAuth();
    const setters: PreferenceSetters = {
        setMode: useThemeStore((s) => s.setMode),
        setLightTheme: useThemeStore((s) => s.setLightTheme),
        setDarkTheme: useThemeStore((s) => s.setDarkTheme),
        setThemeLegacy: useThemeStore((s) => s.setTheme),
        setTimezone: useTimezoneStore((s) => s.setTimezone),
        setViewPref: useCalendarViewStore((s) => s.setViewPref),
    };

    useQuery({
        queryKey: ['user-preferences'],
        queryFn: async () => {
            const prefs = await getMyPreferences();
            applyServerPreferences(prefs, setters);
            return prefs;
        },
        enabled: isAuthenticated,
        staleTime: Infinity,
    });
}
