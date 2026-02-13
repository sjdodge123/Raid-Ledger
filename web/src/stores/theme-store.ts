import { create } from 'zustand';
import { updatePreference } from '../lib/api-client';
import { getAuthToken } from '../hooks/use-auth';

// ============================================================
// Theme Registry (AC-1)
// ============================================================

export type ThemeMode = 'light' | 'dark';

export interface ThemeDefinition {
    id: string;
    name: string;
    mode: ThemeMode;
    /** @deprecated Use `mode` instead. Kept for backward compat. */
    isDark: boolean;
    /** Preview colors for the theme card UI */
    preview: { surface: string; accent: string };
    /** CSS custom property overrides applied when theme is active */
    tokens: Record<string, string>;
}

const THEME_REGISTRY: ThemeDefinition[] = [
    {
        id: 'default-dark',
        name: 'Dark',
        mode: 'dark',
        isDark: true,
        preview: { surface: '#0f172a', accent: '#10b981' },
        tokens: {},
    },
    {
        id: 'default-light',
        name: 'Light',
        mode: 'light',
        isDark: false,
        preview: { surface: '#ffffff', accent: '#10b981' },
        tokens: {},
    },
    {
        id: 'space',
        name: 'Space',
        mode: 'dark',
        isDark: true,
        preview: { surface: '#0a0a1a', accent: '#8b5cf6' },
        tokens: {},
    },
    {
        id: 'quest-log',
        name: 'Quest Log',
        mode: 'light',
        isDark: false,
        preview: { surface: '#f4e8c1', accent: '#c9a84c' },
        tokens: {},
    },
];

export { THEME_REGISTRY };

/** Return only themes categorized as light */
export function getLightThemes(): ThemeDefinition[] {
    return THEME_REGISTRY.filter((t) => t.mode === 'light');
}

/** Return only themes categorized as dark (includes space) */
export function getDarkThemes(): ThemeDefinition[] {
    return THEME_REGISTRY.filter((t) => t.mode === 'dark');
}

// ============================================================
// User Preference Model (AC-2 / AC-3)
// ============================================================

export type ThemeModePreference = 'light' | 'dark' | 'auto';

const MODE_CYCLE: ThemeModePreference[] = ['dark', 'light', 'auto'];

// New localStorage keys
const LS_MODE_KEY = 'raid_ledger_theme_mode';
const LS_LIGHT_THEME_KEY = 'raid_ledger_light_theme';
const LS_DARK_THEME_KEY = 'raid_ledger_dark_theme';
// Legacy keys for backward-compat migration
const LS_LEGACY_THEME_KEY = 'raid_ledger_theme';
const LS_LEGACY_SCHEME_KEY = 'raid_ledger_scheme';

function resolveSystemScheme(): ThemeMode {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
}

/**
 * Resolve the active ThemeDefinition from mode + per-mode theme IDs.
 */
function resolveTheme(
    mode: ThemeModePreference,
    lightThemeId: string,
    darkThemeId: string,
): ThemeDefinition {
    const effectiveMode: ThemeMode = mode === 'auto' ? resolveSystemScheme() : mode;
    const targetId = effectiveMode === 'light' ? lightThemeId : darkThemeId;
    // Find in registry; fall back to the first theme of that mode, then absolute fallback
    return (
        THEME_REGISTRY.find((t) => t.id === targetId) ??
        THEME_REGISTRY.find((t) => t.mode === effectiveMode) ??
        THEME_REGISTRY[0]
    );
}

/**
 * Sub-theme config: maps theme IDs to their data-scheme, color-scheme, and
 * optional data-variant attribute.
 */
const SUB_THEME_CONFIG: Record<
    string,
    { scheme: string; colorScheme: string; variant?: string }
> = {
    space: { scheme: 'space', colorScheme: 'dark' },
    'quest-log': { scheme: 'light', colorScheme: 'light', variant: 'quest-log' },
};

function applyTheme(theme: ThemeDefinition, previousTokens: string[]) {
    const html = document.documentElement;
    const sub = SUB_THEME_CONFIG[theme.id];
    const scheme = sub?.scheme ?? theme.mode;

    html.setAttribute('data-scheme', scheme);
    html.style.colorScheme = sub?.colorScheme ?? scheme;

    if (sub?.variant) {
        html.setAttribute('data-variant', sub.variant);
    } else {
        html.removeAttribute('data-variant');
    }

    // Clear previous theme-specific overrides
    for (const prop of previousTokens) {
        html.style.removeProperty(prop);
    }

    // Apply new theme tokens
    for (const [prop, value] of Object.entries(theme.tokens)) {
        html.style.setProperty(prop, value);
    }
}

function persistToLocalStorage(
    mode: ThemeModePreference,
    lightTheme: string,
    darkTheme: string,
    resolvedThemeId: string,
) {
    localStorage.setItem(LS_MODE_KEY, mode);
    localStorage.setItem(LS_LIGHT_THEME_KEY, lightTheme);
    localStorage.setItem(LS_DARK_THEME_KEY, darkTheme);
    // Keep legacy scheme key for the no-flash script
    // Space theme uses 'space' data-scheme even though its mode is 'dark'
    const sub = SUB_THEME_CONFIG[resolvedThemeId];
    const schemeForFlashScript =
        sub?.scheme === 'space'
            ? 'space'
            : mode === 'auto'
              ? resolveSystemScheme()
              : mode;
    localStorage.setItem(LS_LEGACY_SCHEME_KEY, schemeForFlashScript);
}

function syncToServer(key: string, value: string) {
    if (getAuthToken()) {
        updatePreference(key, value).catch(() => {
            // Fire-and-forget -- silent failure for offline/unauth
        });
    }
}

// ============================================================
// Store Interface
// ============================================================

interface ThemeState {
    /** Mode preference: light, dark, or auto */
    themeMode: ThemeModePreference;
    /** Theme ID for light mode */
    lightTheme: string;
    /** Theme ID for dark mode */
    darkTheme: string;
    /** The currently resolved (applied) theme definition */
    resolved: ThemeDefinition;
    /** Internal: tracks which CSS custom props were set so we can clean up */
    _appliedTokenKeys: string[];

    // -- Legacy aliases for backward compat with existing consumers --
    /** @deprecated Use `themeMode`. Maps: 'light'->'default-light', 'dark'->'default-dark', 'auto'->'auto' */
    themeId: string;

    // -- Actions --
    setMode: (mode: ThemeModePreference) => void;
    setLightTheme: (id: string) => void;
    setDarkTheme: (id: string) => void;

    /** @deprecated Use setMode. Kept for ThemeToggle/MobileNav backward compat */
    setTheme: (id: string) => void;
    /** Cycle mode: dark -> light -> auto */
    cycleTheme: () => void;
}

/**
 * Migrate legacy single-theme localStorage value to the new three-key model.
 * Also handles backward compat for AC-6.
 */
function initFromLocalStorage(): {
    mode: ThemeModePreference;
    lightTheme: string;
    darkTheme: string;
} {
    // Check for new keys first
    const storedMode = localStorage.getItem(LS_MODE_KEY);
    if (storedMode && ['light', 'dark', 'auto'].includes(storedMode)) {
        return {
            mode: storedMode as ThemeModePreference,
            lightTheme: localStorage.getItem(LS_LIGHT_THEME_KEY) ?? 'default-light',
            darkTheme: localStorage.getItem(LS_DARK_THEME_KEY) ?? 'default-dark',
        };
    }
    // Migrate legacy space-as-mode to space-as-dark-sub-theme
    if (storedMode === 'space') {
        localStorage.setItem(LS_MODE_KEY, 'dark');
        localStorage.setItem(LS_DARK_THEME_KEY, 'space');
        return {
            mode: 'dark' as ThemeModePreference,
            lightTheme: localStorage.getItem(LS_LIGHT_THEME_KEY) ?? 'default-light',
            darkTheme: 'space',
        };
    }

    // Legacy migration: old single key
    const legacyTheme = localStorage.getItem(LS_LEGACY_THEME_KEY);
    if (legacyTheme) {
        // Remove legacy key
        localStorage.removeItem(LS_LEGACY_THEME_KEY);

        if (legacyTheme === 'auto') {
            return { mode: 'auto', lightTheme: 'default-light', darkTheme: 'default-dark' };
        }
        if (legacyTheme === 'default-light') {
            return { mode: 'light', lightTheme: 'default-light', darkTheme: 'default-dark' };
        }
        if (legacyTheme === 'default-dark') {
            return { mode: 'dark', lightTheme: 'default-light', darkTheme: 'default-dark' };
        }
        // Unknown legacy theme: check if it was a dark or light theme
        const found = THEME_REGISTRY.find((t) => t.id === legacyTheme);
        if (found) {
            return found.mode === 'dark'
                ? { mode: 'dark', lightTheme: 'default-light', darkTheme: found.id }
                : { mode: 'light', lightTheme: found.id, darkTheme: 'default-dark' };
        }
    }

    // No stored preference -- default to auto
    return { mode: 'auto', lightTheme: 'default-light', darkTheme: 'default-dark' };
}

/** Map mode to a legacy themeId string for backward compat */
function modeToLegacyId(mode: ThemeModePreference): string {
    if (mode === 'auto') return 'auto';
    return mode === 'light' ? 'default-light' : 'default-dark';
}

export const useThemeStore = create<ThemeState>((set, get) => {
    const initial = initFromLocalStorage();
    const initialResolved = resolveTheme(initial.mode, initial.lightTheme, initial.darkTheme);

    // Apply on store creation
    applyTheme(initialResolved, []);
    persistToLocalStorage(
        initial.mode,
        initial.lightTheme,
        initial.darkTheme,
        initialResolved.id,
    );

    // Listen for system preference changes (affects auto mode)
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => {
        const state = get();
        if (state.themeMode === 'auto') {
            const newResolved = resolveTheme('auto', state.lightTheme, state.darkTheme);
            applyTheme(newResolved, state._appliedTokenKeys);
            persistToLocalStorage('auto', state.lightTheme, state.darkTheme, newResolved.id);
            set({
                resolved: newResolved,
                _appliedTokenKeys: Object.keys(newResolved.tokens),
            });
        }
    });

    function applyAndPersist(
        mode: ThemeModePreference,
        lightTheme: string,
        darkTheme: string,
    ) {
        const state = get();
        const resolved = resolveTheme(mode, lightTheme, darkTheme);
        applyTheme(resolved, state._appliedTokenKeys);
        persistToLocalStorage(mode, lightTheme, darkTheme, resolved.id);

        set({
            themeMode: mode,
            lightTheme,
            darkTheme,
            resolved,
            themeId: modeToLegacyId(mode),
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

        setMode(mode: ThemeModePreference) {
            const state = get();
            applyAndPersist(mode, state.lightTheme, state.darkTheme);
            syncToServer('themeMode', mode);
        },

        setLightTheme(id: string) {
            const state = get();
            applyAndPersist(state.themeMode, id, state.darkTheme);
            syncToServer('lightTheme', id);
        },

        setDarkTheme(id: string) {
            const state = get();
            applyAndPersist(state.themeMode, state.lightTheme, id);
            syncToServer('darkTheme', id);
        },

        /** @deprecated backward compat -- maps old setTheme(id) calls */
        setTheme(id: string) {
            const state = get();
            if (id === 'auto') {
                applyAndPersist('auto', state.lightTheme, state.darkTheme);
                syncToServer('themeMode', 'auto');
            } else if (id === 'default-light') {
                applyAndPersist('light', state.lightTheme, state.darkTheme);
                syncToServer('themeMode', 'light');
            } else if (id === 'default-dark') {
                applyAndPersist('dark', state.lightTheme, state.darkTheme);
                syncToServer('themeMode', 'dark');
            } else {
                // A specific theme ID -- figure out if it's light or dark
                const theme = THEME_REGISTRY.find((t) => t.id === id);
                if (theme?.mode === 'light') {
                    applyAndPersist(state.themeMode, id, state.darkTheme);
                    syncToServer('lightTheme', id);
                } else if (theme?.mode === 'dark') {
                    applyAndPersist(state.themeMode, state.lightTheme, id);
                    syncToServer('darkTheme', id);
                }
            }
        },

        cycleTheme() {
            const state = get();
            const currentIdx = MODE_CYCLE.indexOf(state.themeMode);
            const nextIdx = (currentIdx + 1) % MODE_CYCLE.length;
            const nextMode = MODE_CYCLE[nextIdx];
            applyAndPersist(nextMode, state.lightTheme, state.darkTheme);
            syncToServer('themeMode', nextMode);
        },
    };
});
