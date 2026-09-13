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
 */
export function useForcedDarkRoot(active: boolean): void {
    const applyScheme = useApplyScheme();
    useEffect(() => {
        if (!active) return;
        const previousId = useThemeStore.getState().resolved.id;
        applyScheme('default-dark');
        return () => applyScheme(previousId);
    }, [active, applyScheme]);
}
