import { useSyncExternalStore, useCallback } from 'react';

/**
 * React hook that listens to a CSS media query and returns whether it matches.
 * Uses useSyncExternalStore for safe, tear-free reads of browser state.
 */
export function useMediaQuery(query: string): boolean {
    const subscribe = useCallback(
        (callback: () => void) => {
            const mql = window.matchMedia(query);
            mql.addEventListener('change', callback);
            return () => mql.removeEventListener('change', callback);
        },
        [query],
    );

    const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

    const getServerSnapshot = useCallback(() => false, []);

    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
