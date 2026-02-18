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
export function useKeyboardNav({ onEscape, onSelect, orientation = 'vertical' }: UseKeyboardNavOptions = {}) {
    const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLElement>) => {
            const container = e.currentTarget;
            const items = Array.from(
                container.querySelectorAll<HTMLElement>('[data-nav-item]'),
            ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);

            if (items.length === 0) return;

            const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
            const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';

            const currentIndex = items.indexOf(document.activeElement as HTMLElement);

            switch (e.key) {
                case nextKey: {
                    e.preventDefault();
                    const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
                    items[next].focus();
                    break;
                }
                case prevKey: {
                    e.preventDefault();
                    const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                    items[prev].focus();
                    break;
                }
                case 'Home': {
                    e.preventDefault();
                    items[0].focus();
                    break;
                }
                case 'End': {
                    e.preventDefault();
                    items[items.length - 1].focus();
                    break;
                }
                case 'Enter':
                case ' ': {
                    if (currentIndex >= 0) {
                        e.preventDefault();
                        onSelect?.(currentIndex);
                    }
                    break;
                }
                case 'Escape': {
                    e.preventDefault();
                    onEscape?.();
                    break;
                }
            }
        },
        [onEscape, onSelect, orientation],
    );

    return { onKeyDown };
}
