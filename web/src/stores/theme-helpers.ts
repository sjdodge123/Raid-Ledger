/**
 * Theme helper functions: resolution, application, persistence.
 * Pure functions -- no store imports, no side effects at module level.
 */

import type { ThemeMode, ThemeDefinition } from './theme-registry';
import { THEME_REGISTRY } from './theme-registry';

export type ThemeModePreference = 'light' | 'dark' | 'auto';

export const MODE_CYCLE: ThemeModePreference[] = ['dark', 'light', 'auto'];

// LocalStorage keys
export const LS_MODE_KEY = 'raid_ledger_theme_mode';
export const LS_LIGHT_THEME_KEY = 'raid_ledger_light_theme';
export const LS_DARK_THEME_KEY = 'raid_ledger_dark_theme';
const LS_LEGACY_THEME_KEY = 'raid_ledger_theme';
const LS_LEGACY_SCHEME_KEY = 'raid_ledger_scheme';

/** Detect system color scheme */
export function resolveSystemScheme(): ThemeMode {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
}

/** Resolve the active ThemeDefinition from mode + per-mode IDs */
export function resolveTheme(
    mode: ThemeModePreference,
    lightThemeId: string,
    darkThemeId: string,
): ThemeDefinition {
    const effectiveMode: ThemeMode =
        mode === 'auto' ? resolveSystemScheme() : mode;
    const targetId =
        effectiveMode === 'light' ? lightThemeId : darkThemeId;
    return (
        THEME_REGISTRY.find((t) => t.id === targetId) ??
        THEME_REGISTRY.find((t) => t.mode === effectiveMode) ??
        THEME_REGISTRY[0]
    );
}

/**
 * Sub-theme config: maps theme IDs to their data-scheme,
 * color-scheme, and optional data-variant attribute.
 */
export const SUB_THEME_CONFIG: Record<
    string,
    { scheme: string; colorScheme: string; variant?: string }
> = {
    space: { scheme: 'space', colorScheme: 'dark' },
    'quest-log': { scheme: 'light', colorScheme: 'light', variant: 'quest-log' },
    underwater: { scheme: 'underwater', colorScheme: 'dark' },
    sky: { scheme: 'sky', colorScheme: 'light' },
    obsidian: { scheme: 'obsidian', colorScheme: 'dark' },
    dawn: { scheme: 'dawn', colorScheme: 'light' },
    ember: { scheme: 'ember', colorScheme: 'dark' },
    holy: { scheme: 'holy', colorScheme: 'light' },
    arctic: { scheme: 'arctic', colorScheme: 'dark' },
    celestial: { scheme: 'celestial', colorScheme: 'light' },
    bloodmoon: { scheme: 'bloodmoon', colorScheme: 'dark' },
    forest: { scheme: 'forest', colorScheme: 'dark' },
    fel: { scheme: 'fel', colorScheme: 'dark' },
};

/** Apply theme to the DOM */
export function applyTheme(
    theme: ThemeDefinition,
    previousTokens: string[],
): void {
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

    for (const prop of previousTokens) {
        html.style.removeProperty(prop);
    }
    for (const [prop, value] of Object.entries(theme.tokens)) {
        html.style.setProperty(prop, value);
    }
}

/** Persist theme preferences to localStorage */
export function persistToLocalStorage(
    mode: ThemeModePreference,
    lightTheme: string,
    darkTheme: string,
    resolvedThemeId: string,
): void {
    localStorage.setItem(LS_MODE_KEY, mode);
    localStorage.setItem(LS_LIGHT_THEME_KEY, lightTheme);
    localStorage.setItem(LS_DARK_THEME_KEY, darkTheme);
    const sub = SUB_THEME_CONFIG[resolvedThemeId];
    const schemeForFlashScript =
        sub?.scheme && sub.scheme !== sub.colorScheme
            ? sub.scheme
            : mode === 'auto'
                ? resolveSystemScheme()
                : mode;
    localStorage.setItem(LS_LEGACY_SCHEME_KEY, schemeForFlashScript);
}

/** Initialize preferences from localStorage with legacy migration */
export function initFromLocalStorage(): {
    mode: ThemeModePreference;
    lightTheme: string;
    darkTheme: string;
} {
    const storedMode = localStorage.getItem(LS_MODE_KEY);
    if (storedMode && ['light', 'dark', 'auto'].includes(storedMode)) {
        return {
            mode: storedMode as ThemeModePreference,
            lightTheme: localStorage.getItem(LS_LIGHT_THEME_KEY) ?? 'default-light',
            darkTheme: localStorage.getItem(LS_DARK_THEME_KEY) ?? 'default-dark',
        };
    }

    if (storedMode === 'space') {
        localStorage.setItem(LS_MODE_KEY, 'dark');
        localStorage.setItem(LS_DARK_THEME_KEY, 'space');
        return {
            mode: 'dark' as ThemeModePreference,
            lightTheme: localStorage.getItem(LS_LIGHT_THEME_KEY) ?? 'default-light',
            darkTheme: 'space',
        };
    }

    return migrateLegacyTheme();
}

/** Migrate from legacy single-theme localStorage key */
function migrateLegacyTheme(): {
    mode: ThemeModePreference;
    lightTheme: string;
    darkTheme: string;
} {
    const legacyTheme = localStorage.getItem(LS_LEGACY_THEME_KEY);
    if (!legacyTheme) {
        return { mode: 'auto', lightTheme: 'default-light', darkTheme: 'default-dark' };
    }

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

    const found = THEME_REGISTRY.find((t) => t.id === legacyTheme);
    if (found) {
        return found.mode === 'dark'
            ? { mode: 'dark', lightTheme: 'default-light', darkTheme: found.id }
            : { mode: 'light', lightTheme: found.id, darkTheme: 'default-dark' };
    }

    return { mode: 'auto', lightTheme: 'default-light', darkTheme: 'default-dark' };
}

/** Map mode to a legacy themeId string for backward compat */
export function modeToLegacyId(mode: ThemeModePreference): string {
    if (mode === 'auto') return 'auto';
    return mode === 'light' ? 'default-light' : 'default-dark';
}
