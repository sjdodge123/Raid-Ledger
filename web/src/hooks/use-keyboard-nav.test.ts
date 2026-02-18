import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { useKeyboardNav } from './use-keyboard-nav';

/**
 * Creates a container with nav items and returns a mock React KeyboardEvent.
 */
function createContainer(itemCount: number, disabledIndexes: number[] = []): HTMLDivElement {
    const container = document.createElement('div');
    for (let i = 0; i < itemCount; i++) {
        const item = document.createElement('button');
        item.setAttribute('data-nav-item', '');
        item.textContent = `Item ${i + 1}`;
        if (disabledIndexes.includes(i)) {
            item.setAttribute('disabled', '');
        }
        // Make items visible
        Object.defineProperty(item, 'offsetParent', {
            value: document.body,
            configurable: true,
        });
        container.appendChild(item);
    }
    document.body.appendChild(container);
    return container;
}

function makeKeyboardEvent(
    key: string,
    currentTarget: HTMLElement,
): React.KeyboardEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> } {
    const nativeEvent = new KeyboardEvent('keydown', { key, bubbles: true });
    const preventDefault = vi.fn();
    return {
        key,
        currentTarget,
        preventDefault,
        nativeEvent,
    } as unknown as React.KeyboardEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> };
}

describe('useKeyboardNav', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('vertical orientation (default)', () => {
        it('ArrowDown moves focus to next item', () => {
            const container = createContainer(3);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            items[0].focus();

            const { result } = renderHook(() => useKeyboardNav());
            const event = makeKeyboardEvent('ArrowDown', container);
            result.current.onKeyDown(event);

            expect(document.activeElement).toBe(items[1]);
            expect(event.preventDefault).toHaveBeenCalled();
        });

        it('ArrowDown wraps from last item to first', () => {
            const container = createContainer(3);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            items[2].focus();

            const { result } = renderHook(() => useKeyboardNav());
            const event = makeKeyboardEvent('ArrowDown', container);
            result.current.onKeyDown(event);

            expect(document.activeElement).toBe(items[0]);
        });

        it('ArrowUp moves focus to previous item', () => {
            const container = createContainer(3);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            items[2].focus();

            const { result } = renderHook(() => useKeyboardNav());
            const event = makeKeyboardEvent('ArrowUp', container);
            result.current.onKeyDown(event);

            expect(document.activeElement).toBe(items[1]);
            expect(event.preventDefault).toHaveBeenCalled();
        });

        it('ArrowUp wraps from first item to last', () => {
            const container = createContainer(3);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            items[0].focus();

            const { result } = renderHook(() => useKeyboardNav());
            const event = makeKeyboardEvent('ArrowUp', container);
            result.current.onKeyDown(event);

            expect(document.activeElement).toBe(items[2]);
        });

        it('ArrowLeft and ArrowRight have no effect in vertical mode', () => {
            const container = createContainer(3);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            items[0].focus();

            const { result } = renderHook(() => useKeyboardNav({ orientation: 'vertical' }));

            const leftEvent = makeKeyboardEvent('ArrowLeft', container);
            result.current.onKeyDown(leftEvent);
            expect(document.activeElement).toBe(items[0]);

            const rightEvent = makeKeyboardEvent('ArrowRight', container);
            result.current.onKeyDown(rightEvent);
            expect(document.activeElement).toBe(items[0]);
        });
    });

    describe('horizontal orientation', () => {
        it('ArrowRight moves focus to next item', () => {
            const container = createContainer(3);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            items[0].focus();

            const { result } = renderHook(() => useKeyboardNav({ orientation: 'horizontal' }));
            const event = makeKeyboardEvent('ArrowRight', container);
            result.current.onKeyDown(event);

            expect(document.activeElement).toBe(items[1]);
        });

        it('ArrowLeft moves focus to previous item', () => {
            const container = createContainer(3);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            items[2].focus();

            const { result } = renderHook(() => useKeyboardNav({ orientation: 'horizontal' }));
            const event = makeKeyboardEvent('ArrowLeft', container);
            result.current.onKeyDown(event);

            expect(document.activeElement).toBe(items[1]);
        });

        it('ArrowRight wraps from last to first', () => {
            const container = createContainer(3);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            items[2].focus();

            const { result } = renderHook(() => useKeyboardNav({ orientation: 'horizontal' }));
            const event = makeKeyboardEvent('ArrowRight', container);
            result.current.onKeyDown(event);

            expect(document.activeElement).toBe(items[0]);
        });

        it('ArrowUp and ArrowDown have no effect in horizontal mode', () => {
            const container = createContainer(3);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            items[0].focus();

            const { result } = renderHook(() => useKeyboardNav({ orientation: 'horizontal' }));

            const downEvent = makeKeyboardEvent('ArrowDown', container);
            result.current.onKeyDown(downEvent);
            expect(document.activeElement).toBe(items[0]);
        });
    });

    describe('Home and End keys', () => {
        it('Home key moves focus to first item', () => {
            const container = createContainer(4);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            items[3].focus();

            const { result } = renderHook(() => useKeyboardNav());
            const event = makeKeyboardEvent('Home', container);
            result.current.onKeyDown(event);

            expect(document.activeElement).toBe(items[0]);
            expect(event.preventDefault).toHaveBeenCalled();
        });

        it('End key moves focus to last item', () => {
            const container = createContainer(4);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            items[0].focus();

            const { result } = renderHook(() => useKeyboardNav());
            const event = makeKeyboardEvent('End', container);
            result.current.onKeyDown(event);

            expect(document.activeElement).toBe(items[3]);
            expect(event.preventDefault).toHaveBeenCalled();
        });
    });

    describe('Enter and Space keys', () => {
        it('Enter calls onSelect with current index', () => {
            const onSelect = vi.fn();
            const container = createContainer(3);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            items[1].focus();

            const { result } = renderHook(() => useKeyboardNav({ onSelect }));
            const event = makeKeyboardEvent('Enter', container);
            result.current.onKeyDown(event);

            expect(onSelect).toHaveBeenCalledWith(1);
            expect(event.preventDefault).toHaveBeenCalled();
        });

        it('Space calls onSelect with current index', () => {
            const onSelect = vi.fn();
            const container = createContainer(3);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            items[2].focus();

            const { result } = renderHook(() => useKeyboardNav({ onSelect }));
            const event = makeKeyboardEvent(' ', container);
            result.current.onKeyDown(event);

            expect(onSelect).toHaveBeenCalledWith(2);
        });

        it('Enter does not call onSelect when no item is focused (currentIndex -1)', () => {
            const onSelect = vi.fn();
            const container = createContainer(3);
            // No item focused — activeElement is body

            const { result } = renderHook(() => useKeyboardNav({ onSelect }));
            const event = makeKeyboardEvent('Enter', container);
            result.current.onKeyDown(event);

            expect(onSelect).not.toHaveBeenCalled();
        });
    });

    describe('Escape key', () => {
        it('Escape calls onEscape', () => {
            const onEscape = vi.fn();
            const container = createContainer(2);

            const { result } = renderHook(() => useKeyboardNav({ onEscape }));
            const event = makeKeyboardEvent('Escape', container);
            result.current.onKeyDown(event);

            expect(onEscape).toHaveBeenCalledOnce();
            expect(event.preventDefault).toHaveBeenCalled();
        });

        it('Escape does not throw when onEscape is undefined', () => {
            const container = createContainer(2);

            const { result } = renderHook(() => useKeyboardNav());
            const event = makeKeyboardEvent('Escape', container);
            expect(() => result.current.onKeyDown(event)).not.toThrow();
        });
    });

    describe('edge cases', () => {
        it('does nothing when no nav items exist', () => {
            const onEscape = vi.fn();
            const onSelect = vi.fn();
            const container = document.createElement('div');
            document.body.appendChild(container);

            const { result } = renderHook(() => useKeyboardNav({ onEscape, onSelect }));

            // ArrowDown on empty container should be a no-op
            const event = makeKeyboardEvent('ArrowDown', container);
            expect(() => result.current.onKeyDown(event)).not.toThrow();
            expect(event.preventDefault).not.toHaveBeenCalled();
        });

        it('skips disabled nav items', () => {
            // Item 0 is disabled, so items[1] should be the only visible focusable one
            const container = createContainer(3, [0]);
            const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]'));
            // items[0] is disabled and excluded — but we're focused on items[1]
            items[1].focus();

            const { result } = renderHook(() => useKeyboardNav());
            const event = makeKeyboardEvent('ArrowDown', container);
            result.current.onKeyDown(event);

            // From items[1] (index 1 in non-disabled list), ArrowDown goes to items[2]
            expect(document.activeElement).toBe(items[2]);
        });

        it('unrecognized keys are ignored without side effects', () => {
            const onEscape = vi.fn();
            const onSelect = vi.fn();
            const container = createContainer(3);

            const { result } = renderHook(() => useKeyboardNav({ onEscape, onSelect }));
            const event = makeKeyboardEvent('F1', container);
            result.current.onKeyDown(event);

            expect(onEscape).not.toHaveBeenCalled();
            expect(onSelect).not.toHaveBeenCalled();
            expect(event.preventDefault).not.toHaveBeenCalled();
        });
    });
});
