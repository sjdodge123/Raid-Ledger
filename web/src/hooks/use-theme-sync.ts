import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, useViewerCacheScope } from './use-auth';
import { getMyPreferences } from '../lib/api-client';
import { useThemeStore } from '../stores/theme-store';
import type { ThemeModePreference } from '../stores/theme-store';
import { useTimezoneStore } from '../stores/timezone-store';
import { useCalendarViewStore } from '../stores/calendar-view-store';
import { useGameFilterStore } from '../stores/game-filter-store';
import { CALENDAR_HIDDEN_LAYERS_PREF, useCalendarLayerFilterStore } from '../stores/calendar-layer-filter-store';

const VALID_MODES: ThemeModePreference[] = ['light', 'dark', 'auto'];

/**
 * Syncs theme, timezone, and calendar view preferences from server on login.
 * Server is source of truth -- overrides localStorage if different.
 * Fetches once per viewer (staleTime: Infinity, key scoped by viewer).
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
    loadSavedFilter: (slugs: string[]) => void;
    loadHiddenLayers: (keys: readonly string[]) => void;
}

/**
 * ROK-1775: the calendar layers the viewer hid. Absent = every layer shown —
 * applied as an explicit empty set, so a previous viewer's set never survives.
 */
function applyHiddenLayers(prefs: Record<string, unknown>, setters: PreferenceSetters): void {
    const saved = prefs[CALENDAR_HIDDEN_LAYERS_PREF];
    setters.loadHiddenLayers(Array.isArray(saved) ? saved.filter((k): k is string => typeof k === 'string') : []);
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
    if (Array.isArray(prefs.calendarGameFilter)) {
        const slugs = prefs.calendarGameFilter.filter((s): s is string => typeof s === 'string');
        if (slugs.length > 0) setters.loadSavedFilter(slugs);
    }
    applyHiddenLayers(prefs, setters);
}

function readSetters(): PreferenceSetters {
    const theme = useThemeStore.getState();
    return {
        setMode: theme.setMode,
        setLightTheme: theme.setLightTheme,
        setDarkTheme: theme.setDarkTheme,
        setThemeLegacy: theme.setTheme,
        setTimezone: useTimezoneStore.getState().setTimezone,
        setViewPref: useCalendarViewStore.getState().setViewPref,
        loadSavedFilter: useGameFilterStore.getState().loadSavedFilter,
        loadHiddenLayers: useCalendarLayerFilterStore.getState().loadHiddenLayers,
    };
}

/**
 * ROK-1775: when the viewer changes (logout, another login, impersonation),
 * drop the previous viewer's hidden-layer set, the unscoped
 * `['user-preferences']` entries the profile panels cache, and the departing
 * viewer's own scoped snapshot — it never goes stale and toggle writes do not
 * update it, so reusing it on their next login would restore old preferences.
 */
function useResetOnViewerChange(viewer: number | 'anon'): void {
    const queryClient = useQueryClient();
    const previous = useRef(viewer);
    useEffect(() => {
        const departing = previous.current;
        if (departing === viewer) return;
        previous.current = viewer;
        useCalendarLayerFilterStore.getState().clearViewer();
        queryClient.removeQueries({ queryKey: ['user-preferences'], exact: true });
        queryClient.removeQueries({ queryKey: ['user-preferences', departing], exact: true });
    }, [viewer, queryClient]);
}

export function useThemeSync() {
    const { isAuthenticated } = useAuth();
    const viewer = useViewerCacheScope();
    useResetOnViewerChange(viewer);

    const { data, isError } = useQuery({
        queryKey: ['user-preferences', viewer],
        queryFn: getMyPreferences,
        enabled: isAuthenticated,
        staleTime: Infinity,
    });
    useEffect(() => {
        if (data) applyServerPreferences(data, readSetters());
    }, [data]);
    useEffect(() => {
        if (isError) useCalendarLayerFilterStore.getState().markHydrated();
    }, [isError]);
}
