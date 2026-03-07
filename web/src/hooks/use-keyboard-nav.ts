import { useCallback } from 'react';

interface UseKeyboardNavOptions {
    /** Called when Escape is pressed */
    onEscape?: () => void;
    /** Called when Enter or Space is pressed on a focusable item */
    onSelect?: (index: number) => void;
    /** Orientation of the list (determines which arrow keys to use) */
    orientation?: 'vertical' | 'horizontal';
}

/**
 * Provides arrow-key navigation within a list of focusable items.
 * Attach the returned onKeyDown to the container element.
 *
 * Children must have `[data-nav-item]` attribute to be included
 * in the navigation cycle.
 *
 * @example
 * ```tsx
 * const { onKeyDown } = useKeyboardNav({ onEscape: close, onSelect: handlePick });
 * <ul role="menu" onKeyDown={onKeyDown}>
 *   <li role="menuitem" data-nav-item tabIndex={-1}>Item 1</li>
 * </ul>
 * ```
 */
function getNavItems(container: HTMLElement): HTMLElement[] {
    return Array.from(
        container.querySelectorAll<HTMLElement>('[data-nav-item]'),
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
}

function handleNavKey(
    e: React.KeyboardEvent<HTMLElement>,
    items: HTMLElement[],
    currentIndex: number,
    prevKey: string,
    nextKey: string,
    onSelect?: (index: number) => void,
    onEscape?: () => void,
): void {
    switch (e.key) {
        case nextKey: { e.preventDefault(); items[(currentIndex + 1) % items.length].focus(); break; }
        case prevKey: { e.preventDefault(); items[currentIndex > 0 ? currentIndex - 1 : items.length - 1].focus(); break; }
        case 'Home': { e.preventDefault(); items[0].focus(); break; }
        case 'End': { e.preventDefault(); items[items.length - 1].focus(); break; }
        case 'Enter': case ' ': { if (currentIndex >= 0) { e.preventDefault(); onSelect?.(currentIndex); } break; }
        case 'Escape': { e.preventDefault(); onEscape?.(); break; }
    }
}

export function useKeyboardNav({ onEscape, onSelect, orientation = 'vertical' }: UseKeyboardNavOptions = {}) {
    const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLElement>) => {
            const items = getNavItems(e.currentTarget);
            if (items.length === 0) return;
            const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
            const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
            const currentIndex = items.indexOf(document.activeElement as HTMLElement);
            handleNavKey(e, items, currentIndex, prevKey, nextKey, onSelect, onEscape);
        },
        [onEscape, onSelect, orientation],
    );

    return { onKeyDown };
}
