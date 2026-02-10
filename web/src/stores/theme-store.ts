import { create } from 'zustand';
import { updatePreference } from '../lib/api-client';
import { getAuthToken } from '../hooks/use-auth';

export interface ThemeDefinition {
    id: string;
    name: string;
    isDark: boolean;
    tokens: Record<string, string>;
}

const THEME_REGISTRY: ThemeDefinition[] = [
    { id: 'default-dark', name: 'Dark', isDark: true, tokens: {} },
    { id: 'default-light', name: 'Light', isDark: false, tokens: {} },
];

export { THEME_REGISTRY };

const CYCLE_ORDER = ['default-dark', 'default-light', 'auto'] as const;

const LS_THEME_KEY = 'raid_ledger_theme';
const LS_SCHEME_KEY = 'raid_ledger_scheme';

function resolveSystemScheme(): 'dark' | 'light' {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
}

function resolveTheme(id: string): ThemeDefinition {
    if (id === 'auto') {
        const scheme = resolveSystemScheme();
        return (
            THEME_REGISTRY.find((t) => t.id === `default-${scheme}`) ??
            THEME_REGISTRY[0]
        );
    }
    return THEME_REGISTRY.find((t) => t.id === id) ?? THEME_REGISTRY[0];
}

function applyTheme(theme: ThemeDefinition, previousTokens: string[]) {
    const html = document.documentElement;
    const scheme = theme.isDark ? 'dark' : 'light';

    html.setAttribute('data-scheme', scheme);
    html.style.colorScheme = scheme;

    // Clear previous theme-specific overrides
    for (const prop of previousTokens) {
        html.style.removeProperty(prop);
    }

    // Apply new theme tokens
    for (const [prop, value] of Object.entries(theme.tokens)) {
        html.style.setProperty(prop, value);
    }
}

function persistTheme(themeId: string, scheme: 'dark' | 'light') {
    localStorage.setItem(LS_THEME_KEY, themeId);
    localStorage.setItem(LS_SCHEME_KEY, scheme);
}

function syncToServer(themeId: string) {
    if (getAuthToken()) {
        updatePreference('theme', themeId).catch(() => {
            // Fire-and-forget — silent failure for offline/unauth
        });
    }
}

interface ThemeState {
    themeId: string;
    resolved: ThemeDefinition;
    _appliedTokenKeys: string[];
    setTheme: (id: string) => void;
    cycleTheme: () => void;
}

function initThemeId(): string {
    return localStorage.getItem(LS_THEME_KEY) ?? 'auto';
}

export const useThemeStore = create<ThemeState>((set, get) => {
    const initialId = initThemeId();
    const initialResolved = resolveTheme(initialId);

    // Apply on store creation
    applyTheme(initialResolved, []);
    persistTheme(initialId, initialResolved.isDark ? 'dark' : 'light');

    // Listen for system preference changes (for auto mode)
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => {
        const state = get();
        if (state.themeId === 'auto') {
            const newResolved = resolveTheme('auto');
            applyTheme(newResolved, state._appliedTokenKeys);
            persistTheme('auto', newResolved.isDark ? 'dark' : 'light');
            set({
                resolved: newResolved,
                _appliedTokenKeys: Object.keys(newResolved.tokens),
            });
        }
    });

    return {
        themeId: initialId,
        resolved: initialResolved,
        _appliedTokenKeys: Object.keys(initialResolved.tokens),

        setTheme(id: string) {
            const state = get();
            const resolved = resolveTheme(id);
            const scheme = resolved.isDark ? 'dark' : 'light';

            applyTheme(resolved, state._appliedTokenKeys);
            persistTheme(id, scheme);
            syncToServer(id);

            set({
                themeId: id,
                resolved,
                _appliedTokenKeys: Object.keys(resolved.tokens),
            });
        },

        cycleTheme() {
            const state = get();
            const currentIdx = CYCLE_ORDER.indexOf(
                state.themeId as (typeof CYCLE_ORDER)[number],
            );
            const nextIdx = (currentIdx + 1) % CYCLE_ORDER.length;
            state.setTheme(CYCLE_ORDER[nextIdx]);
        },
    };
});
