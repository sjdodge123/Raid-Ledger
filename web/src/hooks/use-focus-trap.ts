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
 * @param initialFocusRef Element to focus on activation instead of the
 *   container's first focusable element
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

/**
 * Move focus into the container on activation — unless it is already inside
 * (an autoFocus input, or someone who typed within the first frame): moving
 * it would blur that field, and a Combobox closes its popup on blur (ROK-1647).
 */
function focusInitial(container: HTMLElement, initialFocusRef?: React.RefObject<HTMLElement | null>): void {
    if (container.contains(document.activeElement)) return;
    if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
        return;
    }
    getFocusableElements(container)[0]?.focus();
}

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
    active: boolean,
    initialFocusRef?: React.RefObject<HTMLElement | null>,
) {
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
            if (containerRef.current) focusInitial(containerRef.current, initialFocusRef);
        });

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            cancelAnimationFrame(timer);
            previousFocusRef.current?.focus();
        };
    }, [active, handleKeyDown, initialFocusRef]);

    return containerRef;
}
