import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAriaLive } from './use-aria-live';

describe('useAriaLive', () => {
    let politeEl: HTMLDivElement;
    let assertiveEl: HTMLDivElement;

    beforeEach(() => {
        // Set up live region containers as LiveRegionProvider would
        politeEl = document.createElement('div');
        politeEl.id = 'aria-live-polite';
        document.body.appendChild(politeEl);

        assertiveEl = document.createElement('div');
        assertiveEl.id = 'aria-live-assertive';
        document.body.appendChild(assertiveEl);
    });

    afterEach(() => {
        politeEl.remove();
        assertiveEl.remove();
    });

    it('returns an announce function', () => {
        const { result } = renderHook(() => useAriaLive());
        expect(result.current.announce).toBeTypeOf('function');
    });

    it('defaults to polite priority when no priority is given', async () => {
        const { result } = renderHook(() => useAriaLive());

        act(() => {
            result.current.announce('Hello screen reader');
        });

        // After requestAnimationFrame, the polite container should be updated
        await act(async () => {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        });

        expect(politeEl.textContent).toBe('Hello screen reader');
        expect(assertiveEl.textContent).toBe('');
    });

    it('targets the polite container when priority is "polite"', async () => {
        const { result } = renderHook(() => useAriaLive());

        act(() => {
            result.current.announce('Polite message', 'polite');
        });

        await act(async () => {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        });

        expect(politeEl.textContent).toBe('Polite message');
        expect(assertiveEl.textContent).toBe('');
    });

    it('targets the assertive container when priority is "assertive"', async () => {
        const { result } = renderHook(() => useAriaLive());

        act(() => {
            result.current.announce('Urgent alert', 'assertive');
        });

        await act(async () => {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        });

        expect(assertiveEl.textContent).toBe('Urgent alert');
        expect(politeEl.textContent).toBe('');
    });

    it('clears text content before setting — enables re-announcing identical messages', async () => {
        const { result } = renderHook(() => useAriaLive());

        // First announcement
        act(() => {
            result.current.announce('Same message');
        });
        await act(async () => {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        });
        expect(politeEl.textContent).toBe('Same message');

        // Second identical announcement — clear + rAF pattern ensures re-announcement
        act(() => {
            result.current.announce('Same message');
        });

        // Immediately after call (before rAF), container should be empty
        expect(politeEl.textContent).toBe('');

        await act(async () => {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        });

        expect(politeEl.textContent).toBe('Same message');
    });

    it('does nothing when the live region container is not in the DOM', () => {
        // Remove the containers
        politeEl.remove();
        assertiveEl.remove();

        const { result } = renderHook(() => useAriaLive());

        // Should not throw
        expect(() => {
            act(() => {
                result.current.announce('No container');
            });
        }).not.toThrow();
    });

    it('does nothing for assertive when assertive container is absent', () => {
        assertiveEl.remove();

        const { result } = renderHook(() => useAriaLive());

        expect(() => {
            act(() => {
                result.current.announce('Urgent', 'assertive');
            });
        }).not.toThrow();
    });

    it('announce is stable across renders (same function reference)', () => {
        const { result, rerender } = renderHook(() => useAriaLive());
        const firstAnnounce = result.current.announce;
        rerender();
        expect(result.current.announce).toBe(firstAnnounce);
    });

    it('announces empty string without throwing', async () => {
        const { result } = renderHook(() => useAriaLive());

        act(() => {
            result.current.announce('');
        });

        await act(async () => {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        });

        expect(politeEl.textContent).toBe('');
    });
});
