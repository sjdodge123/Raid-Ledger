import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useScrollDirection } from '../use-scroll-direction';

describe('useScrollDirection', () => {
    let originalScrollY: number;
    let originalMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
        originalScrollY = window.scrollY;
        originalMatchMedia = window.matchMedia;

        // Mock scrollY
        Object.defineProperty(window, 'scrollY', {
            writable: true,
            configurable: true,
            value: 0,
        });

        // Mock matchMedia to simulate mobile viewport by default
        window.matchMedia = vi.fn((query: string) => {
            return {
                matches: query.includes('max-width'),
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                addListener: vi.fn(),
                removeListener: vi.fn(),
                dispatchEvent: vi.fn(),
                onchange: null,
            } as MediaQueryList;
        });
    });

    afterEach(() => {
        // Restore original values
        Object.defineProperty(window, 'scrollY', {
            writable: true,
            configurable: true,
            value: originalScrollY,
        });
        window.matchMedia = originalMatchMedia;

        // Clean up any lingering scroll listeners
        window.removeEventListener('scroll', () => {});
    });

    it('returns null initially', () => {
        const { result } = renderHook(() => useScrollDirection());
        expect(result.current).toBe(null);
    });

    it('returns "down" when scrolling down past threshold (>100px)', async () => {
        const { result } = renderHook(() => useScrollDirection());

        expect(result.current).toBe(null);

        // Simulate scroll down past threshold
        act(() => {
            Object.defineProperty(window, 'scrollY', { value: 150, writable: true });
            window.dispatchEvent(new Event('scroll'));
        });

        // Wait for RAF to process
        await waitFor(() => {
            expect(result.current).toBe('down');
        });
    });

    it('returns "up" when scrolling up from any position', async () => {
        const { result } = renderHook(() => useScrollDirection());

        // Start scrolled down
        act(() => {
            Object.defineProperty(window, 'scrollY', { value: 200, writable: true });
            window.dispatchEvent(new Event('scroll'));
        });

        await waitFor(() => {
            expect(result.current).toBe('down');
        });

        // Scroll up
        act(() => {
            Object.defineProperty(window, 'scrollY', { value: 150, writable: true });
            window.dispatchEvent(new Event('scroll'));
        });

        await waitFor(() => {
            expect(result.current).toBe('up');
        });
    });

    it('does not report "down" until scrolled past 100px threshold', async () => {
        const { result } = renderHook(() => useScrollDirection());

        // Scroll down but below threshold
        act(() => {
            Object.defineProperty(window, 'scrollY', { value: 50, writable: true });
            window.dispatchEvent(new Event('scroll'));
        });

        // Wait a bit for RAF
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(result.current).toBe(null);
    });

    it('reports "down" exactly at threshold (100px)', async () => {
        const { result } = renderHook(() => useScrollDirection());

        act(() => {
            Object.defineProperty(window, 'scrollY', { value: 101, writable: true });
            window.dispatchEvent(new Event('scroll'));
        });

        await waitFor(() => {
            expect(result.current).toBe('down');
        });
    });

    it('does not attach listener on desktop viewport', () => {
        // Mock desktop viewport (>= 768px)
        window.matchMedia = vi.fn((query: string) => {
            return {
                matches: !query.includes('max-width'), // desktop doesn't match max-width
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                addListener: vi.fn(),
                removeListener: vi.fn(),
                dispatchEvent: vi.fn(),
                onchange: null,
            } as MediaQueryList;
        });

        const { result } = renderHook(() => useScrollDirection());

        expect(result.current).toBe(null);

        // Simulate scroll
        act(() => {
            Object.defineProperty(window, 'scrollY', { value: 200, writable: true });
            window.dispatchEvent(new Event('scroll'));
        });

        // Should remain null on desktop
        expect(result.current).toBe(null);
    });

    it('only notifies subscribers when direction changes', async () => {
        const { result } = renderHook(() => useScrollDirection());

        // Scroll down
        act(() => {
            Object.defineProperty(window, 'scrollY', { value: 200, writable: true });
            window.dispatchEvent(new Event('scroll'));
        });

        await waitFor(() => {
            expect(result.current).toBe('down');
        });

        // Continue scrolling down (no direction change)
        const previousValue = result.current;
        act(() => {
            Object.defineProperty(window, 'scrollY', { value: 300, writable: true });
            window.dispatchEvent(new Event('scroll'));
        });

        // Direction should remain the same
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(result.current).toBe(previousValue);
    });

    it('uses requestAnimationFrame to throttle updates', async () => {
        const rafSpy = vi.spyOn(window, 'requestAnimationFrame');

        renderHook(() => useScrollDirection());

        // Trigger multiple scroll events
        act(() => {
            Object.defineProperty(window, 'scrollY', { value: 150, writable: true });
            window.dispatchEvent(new Event('scroll'));
            window.dispatchEvent(new Event('scroll'));
            window.dispatchEvent(new Event('scroll'));
        });

        // Should only call RAF once (throttled)
        expect(rafSpy).toHaveBeenCalledTimes(1);

        rafSpy.mockRestore();
    });

    it('cleans up scroll listener when all subscribers unmount', () => {
        const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

        const { unmount: unmount1 } = renderHook(() => useScrollDirection());
        const { unmount: unmount2 } = renderHook(() => useScrollDirection());

        // Unmount first hook - listener should remain (1 subscriber left)
        unmount1();
        expect(removeEventListenerSpy).not.toHaveBeenCalledWith('scroll', expect.any(Function));

        // Unmount second hook - listener should be removed (0 subscribers)
        unmount2();
        expect(removeEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function));

        removeEventListenerSpy.mockRestore();
    });

    it('shares scroll listener across multiple hook instances', () => {
        const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

        renderHook(() => useScrollDirection());
        renderHook(() => useScrollDirection());
        renderHook(() => useScrollDirection());

        // Should only attach listener once (singleton pattern)
        expect(addEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
        expect(addEventListenerSpy).toHaveBeenCalledTimes(1);

        addEventListenerSpy.mockRestore();
    });

    it('all hook instances receive the same direction value', async () => {
        const { result: result1 } = renderHook(() => useScrollDirection());
        const { result: result2 } = renderHook(() => useScrollDirection());
        const { result: result3 } = renderHook(() => useScrollDirection());

        expect(result1.current).toBe(null);
        expect(result2.current).toBe(null);
        expect(result3.current).toBe(null);

        // Trigger scroll
        act(() => {
            Object.defineProperty(window, 'scrollY', { value: 200, writable: true });
            window.dispatchEvent(new Event('scroll'));
        });

        await waitFor(() => {
            expect(result1.current).toBe('down');
            expect(result2.current).toBe('down');
            expect(result3.current).toBe('down');
        });
    });

    it('uses passive: true for scroll listener performance', () => {
        const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

        renderHook(() => useScrollDirection());

        expect(addEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });

        addEventListenerSpy.mockRestore();
    });

    it('handles rapid scroll direction changes correctly', async () => {
        const { result } = renderHook(() => useScrollDirection());

        // Scroll down
        act(() => {
            Object.defineProperty(window, 'scrollY', { value: 200, writable: true });
            window.dispatchEvent(new Event('scroll'));
        });

        await waitFor(() => {
            expect(result.current).toBe('down');
        });

        // Scroll up
        act(() => {
            Object.defineProperty(window, 'scrollY', { value: 150, writable: true });
            window.dispatchEvent(new Event('scroll'));
        });

        await waitFor(() => {
            expect(result.current).toBe('up');
        });

        // Scroll down again
        act(() => {
            Object.defineProperty(window, 'scrollY', { value: 250, writable: true });
            window.dispatchEvent(new Event('scroll'));
        });

        await waitFor(() => {
            expect(result.current).toBe('down');
        });
    });
});
