import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useFilterCap } from './use-filter-cap';

// Constants from the implementation (for computing expected values)
const MINI_CALENDAR_HEIGHT = 260;
const QUICK_ACTIONS_HEIGHT = 120;
const GAPS_AND_PADDING = 48;
const FILTER_HEADER_HEIGHT = 36;
const FILTER_SECTION_PADDING = 32;
const FILTER_ITEM_HEIGHT = 44;

function computeExpected(sidebarHeight: number): number {
    const spaceForItems =
        sidebarHeight -
        MINI_CALENDAR_HEIGHT -
        QUICK_ACTIONS_HEIGHT -
        GAPS_AND_PADDING -
        FILTER_HEADER_HEIGHT -
        FILTER_SECTION_PADDING;
    return Math.max(3, Math.floor(spaceForItems / FILTER_ITEM_HEIGHT));
}

describe('useFilterCap', () => {
    let observeCallback: ResizeObserverCallback | null = null;
    let observedElement: Element | null = null;
    let mockObserve: ReturnType<typeof vi.fn>;
    let mockDisconnect: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        observeCallback = null;
        observedElement = null;
        mockObserve = vi.fn((el: Element) => {
            observedElement = el;
        });
        mockDisconnect = vi.fn();

        // Must be a real class so `new ResizeObserver(...)` works
        const _mockObserve = mockObserve;
        const _mockDisconnect = mockDisconnect;
        globalThis.ResizeObserver = class MockResizeObserver {
            constructor(cb: ResizeObserverCallback) {
                observeCallback = cb;
            }
            observe(el: Element) { _mockObserve(el); }
            unobserve() {}
            disconnect() { _mockDisconnect(); }
        } as unknown as typeof ResizeObserver;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('initial state', () => {
        it('returns Infinity when containerRef is null', () => {
            const ref = { current: null };
            const { result } = renderHook(() => useFilterCap(ref));
            expect(result.current).toBe(Infinity);
        });

        it('computes initial maxVisible from clientHeight on mount', () => {
            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: 800, configurable: true });

            const ref = { current: el };
            const { result } = renderHook(() => useFilterCap(ref));

            expect(result.current).toBe(computeExpected(800));
        });

        it('returns a number, not Infinity, when element is present', () => {
            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: 700, configurable: true });

            const ref = { current: el };
            const { result } = renderHook(() => useFilterCap(ref));

            expect(result.current).not.toBe(Infinity);
            expect(typeof result.current).toBe('number');
        });
    });

    describe('minimum of 3', () => {
        it('enforces minimum of 3 when available space is tiny', () => {
            // Very short sidebar — spaceForItems would be negative
            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });

            const ref = { current: el };
            const { result } = renderHook(() => useFilterCap(ref));

            expect(result.current).toBe(3);
        });

        it('enforces minimum of 3 when sidebar height is 0', () => {
            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: 0, configurable: true });

            const ref = { current: el };
            const { result } = renderHook(() => useFilterCap(ref));

            expect(result.current).toBe(3);
        });

        it('returns exactly 3 when space yields floor of 1', () => {
            // Space that yields fewer than 3 items: e.g. overhead = 496, item_height = 44
            // To get 2 items: need space = 2 * 44 = 88 → sidebarHeight = 88 + 496 = 584
            const overhead = MINI_CALENDAR_HEIGHT + QUICK_ACTIONS_HEIGHT + GAPS_AND_PADDING + FILTER_HEADER_HEIGHT + FILTER_SECTION_PADDING;
            const sidebarHeight = overhead + 2 * FILTER_ITEM_HEIGHT; // exactly 2 items worth of space

            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: sidebarHeight, configurable: true });

            const ref = { current: el };
            const { result } = renderHook(() => useFilterCap(ref));

            // 2 < 3, so minimum kicks in
            expect(result.current).toBe(3);
        });

        it('returns 3 exactly when space yields 3 items', () => {
            const overhead = MINI_CALENDAR_HEIGHT + QUICK_ACTIONS_HEIGHT + GAPS_AND_PADDING + FILTER_HEADER_HEIGHT + FILTER_SECTION_PADDING;
            const sidebarHeight = overhead + 3 * FILTER_ITEM_HEIGHT; // exactly 3 items

            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: sidebarHeight, configurable: true });

            const ref = { current: el };
            const { result } = renderHook(() => useFilterCap(ref));

            expect(result.current).toBe(3);
        });

        it('returns more than 3 when space allows', () => {
            const overhead = MINI_CALENDAR_HEIGHT + QUICK_ACTIONS_HEIGHT + GAPS_AND_PADDING + FILTER_HEADER_HEIGHT + FILTER_SECTION_PADDING;
            const sidebarHeight = overhead + 10 * FILTER_ITEM_HEIGHT;

            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: sidebarHeight, configurable: true });

            const ref = { current: el };
            const { result } = renderHook(() => useFilterCap(ref));

            expect(result.current).toBe(10);
        });
    });

    describe('ResizeObserver integration', () => {
        it('creates a ResizeObserver and observes the element', () => {
            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: 800, configurable: true });

            const ref = { current: el };
            renderHook(() => useFilterCap(ref));

            expect(mockObserve).toHaveBeenCalledWith(el);
        });

        it('calls disconnect on unmount', () => {
            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: 800, configurable: true });

            const ref = { current: el };
            const { unmount } = renderHook(() => useFilterCap(ref));

            unmount();

            expect(mockDisconnect).toHaveBeenCalled();
        });

        it('recalculates maxVisible when ResizeObserver fires', () => {
            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: 800, configurable: true });

            const ref = { current: el };
            const { result } = renderHook(() => useFilterCap(ref));

            const initialValue = result.current;

            // Simulate resize: sidebar grows to 1200px
            act(() => {
                Object.defineProperty(el, 'clientHeight', { value: 1200, configurable: true });
                observeCallback?.([], {} as ResizeObserver);
            });

            expect(result.current).toBeGreaterThan(initialValue);
            expect(result.current).toBe(computeExpected(1200));
        });

        it('recalculates to minimum 3 when resized to tiny height', () => {
            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: 800, configurable: true });

            const ref = { current: el };
            const { result } = renderHook(() => useFilterCap(ref));

            act(() => {
                Object.defineProperty(el, 'clientHeight', { value: 50, configurable: true });
                observeCallback?.([], {} as ResizeObserver);
            });

            expect(result.current).toBe(3);
        });

        it('updates maxVisible on multiple resize events', () => {
            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true });

            const ref = { current: el };
            const { result } = renderHook(() => useFilterCap(ref));

            expect(result.current).toBe(computeExpected(600));

            act(() => {
                Object.defineProperty(el, 'clientHeight', { value: 900, configurable: true });
                observeCallback?.([], {} as ResizeObserver);
            });

            expect(result.current).toBe(computeExpected(900));

            act(() => {
                Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
                observeCallback?.([], {} as ResizeObserver);
            });

            expect(result.current).toBe(computeExpected(400));
        });
    });

    describe('calculation correctness', () => {
        it('uses floor division for item count (partial items do not count)', () => {
            // Space for exactly 5.9 items → should floor to 5
            const overhead = MINI_CALENDAR_HEIGHT + QUICK_ACTIONS_HEIGHT + GAPS_AND_PADDING + FILTER_HEADER_HEIGHT + FILTER_SECTION_PADDING;
            const spaceForItems = Math.floor(5.9 * FILTER_ITEM_HEIGHT); // 5 * 44 + partial
            const sidebarHeight = overhead + spaceForItems;

            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: sidebarHeight, configurable: true });

            const ref = { current: el };
            const { result } = renderHook(() => useFilterCap(ref));

            expect(result.current).toBe(5);
        });

        it('computes correct value for typical 900px sidebar', () => {
            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: 900, configurable: true });

            const ref = { current: el };
            const { result } = renderHook(() => useFilterCap(ref));

            expect(result.current).toBe(computeExpected(900));
        });

        it('does not return fractional values', () => {
            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: 750, configurable: true });

            const ref = { current: el };
            const { result } = renderHook(() => useFilterCap(ref));

            expect(Number.isInteger(result.current)).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('does not throw when containerRef.current changes to null after mount', () => {
            const el = document.createElement('div');
            Object.defineProperty(el, 'clientHeight', { value: 800, configurable: true });

            const ref = { current: el as HTMLElement | null };
            const { result, rerender } = renderHook(() => useFilterCap(ref));

            const valueBefore = result.current;

            // Changing .current after mount doesn't re-run effect (ref identity is stable)
            // This just verifies no crash occurs
            act(() => {
                ref.current = null;
            });
            rerender();

            // Value from the initial computation should remain
            expect(result.current).toBe(valueBefore);
        });

        it('does not observe if element is null on mount', () => {
            const ref = { current: null };
            renderHook(() => useFilterCap(ref));

            expect(mockObserve).not.toHaveBeenCalled();
        });
    });
});
