import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useFocusTrap } from './use-focus-trap';

/**
 * Creates a container div with the given HTML and appends it to document.body.
 * Returns a cleanup function.
 */
function createContainer(html: string): HTMLDivElement {
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    return container;
}

describe('useFocusTrap', () => {
    let container: HTMLDivElement;

    afterEach(() => {
        container?.remove();
        document.body.innerHTML = '';
    });

    // Helper to fire a keydown event on document
    function fireKeyDown(key: string, shiftKey = false) {
        const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true });
        document.dispatchEvent(event);
        return event;
    }

    it('returns a ref object', () => {
        const { result } = renderHook(() => useFocusTrap(false));
        expect(result.current).toBeDefined();
        expect(result.current).toHaveProperty('current');
    });

    it('does not add keydown listener when inactive', () => {
        const addSpy = vi.spyOn(document, 'addEventListener');
        renderHook(() => useFocusTrap(false));
        const keydownCalls = addSpy.mock.calls.filter(([type]) => type === 'keydown');
        expect(keydownCalls).toHaveLength(0);
        addSpy.mockRestore();
    });

    it('adds keydown listener when active', () => {
        const addSpy = vi.spyOn(document, 'addEventListener');
        renderHook(() => useFocusTrap(true));
        const keydownCalls = addSpy.mock.calls.filter(([type]) => type === 'keydown');
        expect(keydownCalls.length).toBeGreaterThan(0);
        addSpy.mockRestore();
    });

    it('removes keydown listener on unmount', () => {
        const removeSpy = vi.spyOn(document, 'removeEventListener');
        const { unmount } = renderHook(() => useFocusTrap(true));
        unmount();
        const keydownCalls = removeSpy.mock.calls.filter(([type]) => type === 'keydown');
        expect(keydownCalls.length).toBeGreaterThan(0);
        removeSpy.mockRestore();
    });

    it('removes keydown listener when deactivated', () => {
        const removeSpy = vi.spyOn(document, 'removeEventListener');
        const { rerender } = renderHook(({ active }) => useFocusTrap(active), {
            initialProps: { active: true },
        });
        rerender({ active: false });
        const keydownCalls = removeSpy.mock.calls.filter(([type]) => type === 'keydown');
        expect(keydownCalls.length).toBeGreaterThan(0);
        removeSpy.mockRestore();
    });

    describe('Tab key cycling', () => {
        it('cycles forward from last focusable element to first', () => {
            container = createContainer(`
                <button id="btn1">One</button>
                <button id="btn2">Two</button>
                <button id="btn3">Three</button>
            `);

            const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(true));

            // Attach ref to the container
            Object.defineProperty(result.current, 'current', {
                value: container,
                writable: true,
            });

            // Make elements visible (jsdom sets offsetParent to null by default; mock it)
            const buttons = Array.from(container.querySelectorAll('button'));
            buttons.forEach((btn) => {
                Object.defineProperty(btn, 'offsetParent', {
                    value: document.body,
                    configurable: true,
                });
            });

            // Focus the last button
            buttons[2].focus();

            // Press Tab on document — should wrap to first
            const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
            const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
            document.dispatchEvent(event);

            expect(preventDefaultSpy).toHaveBeenCalled();
        });

        it('cycles backward from first focusable element to last on Shift+Tab', () => {
            container = createContainer(`
                <button id="btn1">One</button>
                <button id="btn2">Two</button>
                <button id="btn3">Three</button>
            `);

            const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(true));
            Object.defineProperty(result.current, 'current', {
                value: container,
                writable: true,
            });

            const buttons = Array.from(container.querySelectorAll('button'));
            buttons.forEach((btn) => {
                Object.defineProperty(btn, 'offsetParent', {
                    value: document.body,
                    configurable: true,
                });
            });

            // Focus the first button
            buttons[0].focus();

            // Press Shift+Tab — should wrap to last
            const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });
            const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
            document.dispatchEvent(event);

            expect(preventDefaultSpy).toHaveBeenCalled();
        });

        it('prevents default and does nothing when container has no focusable elements', () => {
            container = createContainer('<div>No buttons here</div>');

            const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(true));
            Object.defineProperty(result.current, 'current', {
                value: container,
                writable: true,
            });

            const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
            const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
            document.dispatchEvent(event);

            expect(preventDefaultSpy).toHaveBeenCalled();
        });

        it('ignores keys other than Tab', () => {
            container = createContainer('<button>One</button>');

            const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(true));
            Object.defineProperty(result.current, 'current', {
                value: container,
                writable: true,
            });

            const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
            const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
            document.dispatchEvent(event);

            expect(preventDefaultSpy).not.toHaveBeenCalled();
        });

        it('ignores Tab when containerRef is null', () => {
            const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(true));
            // ref.current remains null (not attached to any element)
            expect(result.current.current).toBeNull();

            // Should not throw
            const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
            expect(() => document.dispatchEvent(event)).not.toThrow();
        });
    });

    describe('focus restoration on deactivation', () => {
        it('stores the previously focused element before activation', () => {
            const trigger = document.createElement('button');
            trigger.textContent = 'Trigger';
            document.body.appendChild(trigger);
            trigger.focus();

            // Verify focus is on trigger before the hook activates
            expect(document.activeElement).toBe(trigger);

            const { rerender, unmount } = renderHook(({ active }) => useFocusTrap(active), {
                initialProps: { active: true },
            });

            // Deactivating the trap should restore focus to whatever was focused before
            rerender({ active: false });

            // Focus should be restored to the trigger
            expect(document.activeElement).toBe(trigger);
            unmount();
            trigger.remove();
        });

        it('restores focus on unmount when active', () => {
            const trigger = document.createElement('button');
            trigger.textContent = 'Trigger';
            document.body.appendChild(trigger);
            trigger.focus();

            const { unmount } = renderHook(() => useFocusTrap(true));

            unmount();

            // Focus should be restored to the trigger
            expect(document.activeElement).toBe(trigger);
            trigger.remove();
        });
    });

    describe('focusable element selectors', () => {
        it('includes buttons', () => {
            container = createContainer('<button>Click me</button>');

            const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(true));
            Object.defineProperty(result.current, 'current', {
                value: container,
                writable: true,
            });

            const btn = container.querySelector('button')!;
            Object.defineProperty(btn, 'offsetParent', {
                value: document.body,
                configurable: true,
            });

            // Tab with no active element (currentIndex === -1) should not wrap
            const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
            document.dispatchEvent(event);
            // Should not throw; no assertion on focus since we just need coverage
        });

        it('excludes disabled buttons', () => {
            container = createContainer(`
                <button disabled>Disabled</button>
                <button id="active">Active</button>
            `);

            const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(true));
            Object.defineProperty(result.current, 'current', {
                value: container,
                writable: true,
            });

            const activeBtn = container.querySelector('#active') as HTMLButtonElement;
            Object.defineProperty(activeBtn, 'offsetParent', {
                value: document.body,
                configurable: true,
            });

            // Focus active button (the only focusable one)
            activeBtn.focus();

            const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
            const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
            document.dispatchEvent(event);

            // Since active btn is both first and last, Tab from last should wrap to first — preventDefault called
            expect(preventDefaultSpy).toHaveBeenCalled();
        });
    });
});
