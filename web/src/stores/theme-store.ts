/**
 * Theme store -- Zustand store for theme preferences.
 * Re-exports types and data from extracted modules.
 */

import { create } from 'zustand';
import { updatePreference } from '../lib/api-client';
import { getAuthToken } from '../hooks/use-auth';

// Re-export for backward compatibility
export type { ThemeMode, ThemeDefinition } from './theme-registry';
export { THEME_REGISTRY, getLightThemes, getDarkThemes } from './theme-registry';

export type { ThemeModePreference } from './theme-helpers';
import type { ThemeModePreference } from './theme-helpers';
import type { ThemeDefinition } from './theme-registry';
import {
    MODE_CYCLE,
    resolveTheme,
    applyTheme,
    persistToLocalStorage,
    initFromLocalStorage,
    modeToLegacyId,
} from './theme-helpers';
import { THEME_REGISTRY } from './theme-registry';

/** Sync preference change to server (fire-and-forget) */
function syncToServer(key: string, value: string): void {
    if (getAuthToken()) {
        updatePreference(key, value).catch(() => {});
    }
}

interface ThemeState {
    themeMode: ThemeModePreference;
    lightTheme: string;
    darkTheme: string;
    resolved: ThemeDefinition;
    _appliedTokenKeys: string[];
    /** @deprecated Use `themeMode` */
    themeId: string;
    setMode: (mode: ThemeModePreference) => void;
    setLightTheme: (id: string) => void;
    setDarkTheme: (id: string) => void;
    /** @deprecated Use setMode */
    setTheme: (id: string) => void;
    cycleTheme: () => void;
}

/** @deprecated backward compat — resolve legacy theme id to mode/theme updates */
function resolveLegacyTheme(
    id: string,
    s: ThemeState,
    doApply: (mode: ThemeModePreference, lt: string, dt: string) => void,
): void {
    if (id === 'auto') {
        doApply('auto', s.lightTheme, s.darkTheme);
        syncToServer('themeMode', 'auto');
    } else if (id === 'default-light') {
        doApply('light', s.lightTheme, s.darkTheme);
        syncToServer('themeMode', 'light');
    } else if (id === 'default-dark') {
        doApply('dark', s.lightTheme, s.darkTheme);
        syncToServer('themeMode', 'dark');
    } else {
        resolveLegacyCustomTheme(id, s, doApply);
    }
}

function resolveLegacyCustomTheme(
    id: string,
    s: ThemeState,
    doApply: (mode: ThemeModePreference, lt: string, dt: string) => void,
): void {
    const theme = THEME_REGISTRY.find((t) => t.id === id);
    if (theme?.mode === 'light') {
        doApply(s.themeMode, id, s.darkTheme);
        syncToServer('lightTheme', id);
    } else if (theme?.mode === 'dark') {
        doApply(s.themeMode, s.lightTheme, id);
        syncToServer('darkTheme', id);
    }
}

function initializeThemeStore(
    get: () => ThemeState,
    set: (partial: Partial<ThemeState>) => void,
): void {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', () => {
        handleSystemThemeChange(get, set);
    });
}

function handleSystemThemeChange(
    get: () => ThemeState,
    set: (partial: Partial<ThemeState>) => void,
): void {
    const state = get();
    if (state.themeMode !== 'auto') return;
    const newResolved = resolveTheme('auto', state.lightTheme, state.darkTheme);
    applyTheme(newResolved, state._appliedTokenKeys);
    persistToLocalStorage('auto', state.lightTheme, state.darkTheme, newResolved.id);
    set({ resolved: newResolved, _appliedTokenKeys: Object.keys(newResolved.tokens) });
}

function doApplyTheme(
    get: () => ThemeState,
    set: (partial: Partial<ThemeState>) => void,
    mode: ThemeModePreference, lt: string, dt: string,
): void {
    const state = get();
    const resolved = resolveTheme(mode, lt, dt);
    applyTheme(resolved, state._appliedTokenKeys);
    persistToLocalStorage(mode, lt, dt, resolved.id);
    set({ themeMode: mode, lightTheme: lt, darkTheme: dt, resolved, themeId: modeToLegacyId(mode), _appliedTokenKeys: Object.keys(resolved.tokens) });
}

function buildThemeActions(get: () => ThemeState, set: (partial: Partial<ThemeState>) => void) {
    const apply = (mode: ThemeModePreference, lt: string, dt: string) => doApplyTheme(get, set, mode, lt, dt);
    return {
        setMode: (mode: ThemeModePreference) => { apply(mode, get().lightTheme, get().darkTheme); syncToServer('themeMode', mode); },
        setLightTheme: (id: string) => { apply(get().themeMode, id, get().darkTheme); syncToServer('lightTheme', id); },
        setDarkTheme: (id: string) => { apply(get().themeMode, get().lightTheme, id); syncToServer('darkTheme', id); },
        setTheme: (id: string) => { resolveLegacyTheme(id, get(), apply); },
        cycleTheme: () => { const s = get(); const next = MODE_CYCLE[(MODE_CYCLE.indexOf(s.themeMode) + 1) % MODE_CYCLE.length]; apply(next, s.lightTheme, s.darkTheme); syncToServer('themeMode', next); },
    };
}

export const useThemeStore = create<ThemeState>((set, get) => {
    const initial = initFromLocalStorage();
    const initialResolved = resolveTheme(initial.mode, initial.lightTheme, initial.darkTheme);
    applyTheme(initialResolved, []);
    persistToLocalStorage(initial.mode, initial.lightTheme, initial.darkTheme, initialResolved.id);
    initializeThemeStore(get, set);

    return {
        themeMode: initial.mode, lightTheme: initial.lightTheme, darkTheme: initial.darkTheme,
        resolved: initialResolved, _appliedTokenKeys: Object.keys(initialResolved.tokens),
        themeId: modeToLegacyId(initial.mode),
        ...buildThemeActions(get, set),
    };
});
