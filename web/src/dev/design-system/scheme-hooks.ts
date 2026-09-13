/**
 * Theme-store hooks for the /dev/design-system scheme controls (ROK-1539).
 *
 * Separate module so `scheme-controls.tsx` stays components-only
 * (react-refresh/only-export-components).
 */
import { useCallback, useEffect } from 'react';
import { useThemeStore } from '../../stores/theme-store';
import { THEME_REGISTRY } from '../../stores/theme-registry';

/** Apply a registry theme id at the root, via the theme store's actions. */
export function useApplyScheme(): (id: string) => void {
    const setMode = useThemeStore((s) => s.setMode);
    const setLightTheme = useThemeStore((s) => s.setLightTheme);
    const setDarkTheme = useThemeStore((s) => s.setDarkTheme);
    return useCallback((id: string): void => {
        const theme = THEME_REGISTRY.find((t) => t.id === id);
        if (!theme) return;
        if (theme.mode === 'light') setLightTheme(id);
        else setDarkTheme(id);
        setMode(theme.mode);
    }, [setMode, setLightTheme, setDarkTheme]);
}

/**
 * While `active`, pin the ROOT to `default-dark` and restore the viewer's own
 * scheme on deactivation or unmount.
 *
 * The dark tokens are declared on `@theme` / `html` only, so the two-family
 * view cannot scope a dark column the way it scopes the light one — the honest
 * alternative is to make the root dark for as long as the comparison is up.
 *
 * Two things the restore has to respect. `mode` is captured alongside the id
 * because `useApplyScheme` always writes an explicit `'light' | 'dark'`, which
 * `persistToLocalStorage` commits — an `auto` viewer who merely toggled this
 * view must not be left pinned. And the cleanup only restores while the root is
 * still the one we pinned: if the viewer picked a scheme in the switcher WHILE
 * the comparison was up, that choice is theirs and must survive the toggle.
 */
export function useForcedDarkRoot(active: boolean): void {
    const applyScheme = useApplyScheme();
    const setMode = useThemeStore((s) => s.setMode);
    useEffect(() => {
        if (!active) return;
        const { resolved, themeMode: previousMode } = useThemeStore.getState();
        const previousId = resolved.id;
        applyScheme('default-dark');
        return () => {
            if (useThemeStore.getState().resolved.id !== 'default-dark') return;
            applyScheme(previousId);
            setMode(previousMode);
        };
    }, [active, applyScheme, setMode]);
}
