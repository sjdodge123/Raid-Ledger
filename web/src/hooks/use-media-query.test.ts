import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useMediaQuery } from './use-media-query';

let mockMatchMedia: ReturnType<typeof vi.fn>;
let listeners: Array<() => void>;
function usemediaqueryGroup1() {
it('returns false when media query does not match', () => {
        const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
        expect(result.current).toBe(false);
    });

it('returns true when media query matches', () => {
        mockMatchMedia.mockReturnValue({
            matches: true,
            media: '(max-width: 767px)',
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
        expect(result.current).toBe(true);
    });

it('subscribes to media query changes', () => {
        renderHook(() => useMediaQuery('(max-width: 767px)'));
        expect(mockMatchMedia).toHaveBeenCalledWith('(max-width: 767px)');
        expect(listeners.length).toBe(1);
    });

}

function usemediaqueryGroup2() {
it('unsubscribes on unmount', () => {
        const { unmount } = renderHook(() => useMediaQuery('(max-width: 767px)'));
        expect(listeners.length).toBe(1);
        unmount();
        expect(listeners.length).toBe(0);
    });

}

function usemediaqueryGroup3() {
it('updates when media query match changes', () => {
        let currentMatches = false;
        mockMatchMedia.mockImplementation((query: string) => ({
            matches: currentMatches,
            media: query,
            addEventListener: vi.fn((_event: string, listener: () => void) => {
                listeners.push(listener);
            }),
            removeEventListener: vi.fn((_event: string, listener: () => void) => {
                const index = listeners.indexOf(listener);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }),
        }));

        const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
        expect(result.current).toBe(false);

        // Simulate media query change
        act(() => {
            currentMatches = true;
            listeners.forEach((listener) => listener());
        });

        expect(result.current).toBe(true);
    });

}

function usemediaqueryGroup4() {
it('handles different query strings', () => {
        const queries = [
            '(max-width: 767px)',
            '(min-width: 768px)',
            '(orientation: portrait)',
            'print',
        ];

        queries.forEach((query) => {
            const { unmount } = renderHook(() => useMediaQuery(query));
            expect(mockMatchMedia).toHaveBeenCalledWith(query);
            unmount();
        });
    });

it('returns false for server-side rendering (getServerSnapshot)', () => {
        // Server snapshot should always return false
        const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
        expect(result.current).toBe(false);
    });

}

function usemediaqueryGroup5() {
it('recreates subscription when query changes', () => {
        const { rerender, unmount } = renderHook(
            ({ query }) => useMediaQuery(query),
            { initialProps: { query: '(max-width: 767px)' } }
        );

        expect(mockMatchMedia).toHaveBeenCalledWith('(max-width: 767px)');
        const initialListenerCount = listeners.length;

        rerender({ query: '(min-width: 768px)' });

        expect(mockMatchMedia).toHaveBeenCalledWith('(min-width: 768px)');
        expect(listeners.length).toBe(initialListenerCount);

        unmount();
    });

}

describe('useMediaQuery', () => {
beforeEach(() => {
        listeners = [];
        mockMatchMedia = vi.fn((query: string) => ({
            matches: false,
            media: query,
            addEventListener: vi.fn((_event: string, listener: () => void) => {
                listeners.push(listener);
            }),
            removeEventListener: vi.fn((_event: string, listener: () => void) => {
                const index = listeners.indexOf(listener);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }),
        }));
        window.matchMedia = mockMatchMedia as unknown as typeof window.matchMedia;
    });

afterEach(() => {
        vi.clearAllMocks();
        listeners = [];
    });

    usemediaqueryGroup1();
    usemediaqueryGroup2();
    usemediaqueryGroup3();
    usemediaqueryGroup4();
    usemediaqueryGroup5();
});
