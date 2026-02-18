import { useCallback } from 'react';

type Priority = 'polite' | 'assertive';

/**
 * Provides an `announce` function for screen reader notifications.
 * Messages are injected into the global live-region containers
 * rendered by `<LiveRegionProvider>`.
 *
 * @example
 * ```tsx
 * const { announce } = useAriaLive();
 * announce('Player assigned to Tank 1');
 * announce('Connection lost', 'assertive');
 * ```
 */
export function useAriaLive() {
    const announce = useCallback((message: string, priority: Priority = 'polite') => {
        const id = priority === 'assertive'
            ? 'aria-live-assertive'
            : 'aria-live-polite';

        const container = document.getElementById(id);
        if (!container) return;

        // Clear then set — ensures repeated identical messages are re-announced
        container.textContent = '';
        requestAnimationFrame(() => {
            container.textContent = message;
        });
    }, []);

    return { announce };
}
