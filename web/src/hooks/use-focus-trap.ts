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
function getFocusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => el.offsetParent !== null);
}

function handleTabTrap(e: KeyboardEvent, container: HTMLElement): void {
    const focusable = getFocusableElements(container);
    if (focusable.length === 0) { e.preventDefault(); return; }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(active: boolean) {
    const containerRef = useRef<T>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key !== 'Tab' || !containerRef.current) return;
        handleTabTrap(e, containerRef.current);
    }, []);

    useEffect(() => {
        if (!active) return;
        previousFocusRef.current = document.activeElement as HTMLElement;
        document.addEventListener('keydown', handleKeyDown);

        const timer = requestAnimationFrame(() => {
            if (!containerRef.current) return;
            getFocusableElements(containerRef.current)[0]?.focus();
        });

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            cancelAnimationFrame(timer);
            previousFocusRef.current?.focus();
        };
    }, [active, handleKeyDown]);

    return containerRef;
}
