import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Traps keyboard focus within a container element.
 * Tab cycles through focusable elements; Shift+Tab cycles backwards.
 * Restores focus to the previously focused element on unmount.
 *
 * @param active Whether the trap is currently active (e.g. modal is open)
 * @returns ref to attach to the container element
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(active: boolean) {
    const containerRef = useRef<T>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key !== 'Tab' || !containerRef.current) return;

        const focusable = Array.from(
            containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => el.offsetParent !== null);

        if (focusable.length === 0) {
            e.preventDefault();
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }, []);

    useEffect(() => {
        if (!active) return;

        previousFocusRef.current = document.activeElement as HTMLElement;
        document.addEventListener('keydown', handleKeyDown);

        // Focus the first focusable element inside the container
        const timer = requestAnimationFrame(() => {
            if (!containerRef.current) return;
            const focusable = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
            const first = Array.from(focusable).find((el) => el.offsetParent !== null);
            first?.focus();
        });

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            cancelAnimationFrame(timer);
            previousFocusRef.current?.focus();
        };
    }, [active, handleKeyDown]);

    return containerRef;
}
