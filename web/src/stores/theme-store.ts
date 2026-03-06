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

export const useThemeStore = create<ThemeState>((set, get) => {
    const initial = initFromLocalStorage();
    const initialResolved = resolveTheme(
        initial.mode, initial.lightTheme, initial.darkTheme,
    );

    applyTheme(initialResolved, []);
    persistToLocalStorage(
        initial.mode, initial.lightTheme,
        initial.darkTheme, initialResolved.id,
    );

    // Listen for system preference changes (auto mode)
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', () => {
        const state = get();
        if (state.themeMode !== 'auto') return;
        const newResolved = resolveTheme(
            'auto', state.lightTheme, state.darkTheme,
        );
        applyTheme(newResolved, state._appliedTokenKeys);
        persistToLocalStorage(
            'auto', state.lightTheme,
            state.darkTheme, newResolved.id,
        );
        set({
            resolved: newResolved,
            _appliedTokenKeys: Object.keys(newResolved.tokens),
        });
    });

    function applyAndPersist(
        mode: ThemeModePreference,
        lt: string,
        dt: string,
    ): void {
        const state = get();
        const resolved = resolveTheme(mode, lt, dt);
        applyTheme(resolved, state._appliedTokenKeys);
        persistToLocalStorage(mode, lt, dt, resolved.id);
        set({
            themeMode: mode, lightTheme: lt, darkTheme: dt,
            resolved, themeId: modeToLegacyId(mode),
            _appliedTokenKeys: Object.keys(resolved.tokens),
        });
    }

    return {
        themeMode: initial.mode,
        lightTheme: initial.lightTheme,
        darkTheme: initial.darkTheme,
        resolved: initialResolved,
        _appliedTokenKeys: Object.keys(initialResolved.tokens),
        themeId: modeToLegacyId(initial.mode),

        setMode(mode) {
            const s = get();
            applyAndPersist(mode, s.lightTheme, s.darkTheme);
            syncToServer('themeMode', mode);
        },
        setLightTheme(id) {
            const s = get();
            applyAndPersist(s.themeMode, id, s.darkTheme);
            syncToServer('lightTheme', id);
        },
        setDarkTheme(id) {
            const s = get();
            applyAndPersist(s.themeMode, s.lightTheme, id);
            syncToServer('darkTheme', id);
        },
        /** @deprecated backward compat */
        setTheme(id) {
            const s = get();
            if (id === 'auto') {
                applyAndPersist('auto', s.lightTheme, s.darkTheme);
                syncToServer('themeMode', 'auto');
            } else if (id === 'default-light') {
                applyAndPersist('light', s.lightTheme, s.darkTheme);
                syncToServer('themeMode', 'light');
            } else if (id === 'default-dark') {
                applyAndPersist('dark', s.lightTheme, s.darkTheme);
                syncToServer('themeMode', 'dark');
            } else {
                const theme = THEME_REGISTRY.find((t) => t.id === id);
                if (theme?.mode === 'light') {
                    applyAndPersist(s.themeMode, id, s.darkTheme);
                    syncToServer('lightTheme', id);
                } else if (theme?.mode === 'dark') {
                    applyAndPersist(s.themeMode, s.lightTheme, id);
                    syncToServer('darkTheme', id);
                }
            }
        },
        cycleTheme() {
            const s = get();
            const idx = MODE_CYCLE.indexOf(s.themeMode);
            const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
            applyAndPersist(next, s.lightTheme, s.darkTheme);
            syncToServer('themeMode', next);
        },
    };
});
