import { useEffect } from 'react';

declare global {
    interface Window {
        $WowheadPower?: {
            refreshLinks: () => void;
        };
    }
}

/**
 * Check whether the Wowhead tooltip script has loaded.
 */
export function isWowheadLoaded(): boolean {
    return typeof window.$WowheadPower?.refreshLinks === 'function';
}

/**
 * Refresh Wowhead tooltip links whenever dependencies change.
 * Call after rendering any elements with data-wowhead attributes.
 */
export function useWowheadTooltips(deps: unknown[] = []) {
    useEffect(() => {
        // Small delay to let DOM render, then refresh
        const timer = setTimeout(() => {
            if (isWowheadLoaded()) {
                window.$WowheadPower!.refreshLinks();
            }
        }, 100);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}
