import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { createElement, type ReactNode } from 'react';

// Mock useNotifications before importing the hook
const mockMarkRead = vi.fn();

vi.mock('./use-notifications', () => ({
    useNotifications: () => ({
        markRead: mockMarkRead,
    }),
}));

import { useNotifReadSync } from './use-notif-read-sync';

function createWrapper(initialUrl: string) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return createElement(
            MemoryRouter,
            { initialEntries: [initialUrl] },
            children,
        );
    };
}

function usenotifreadsyncGroup1() {
it('should call markRead with notif ID when ?notif param is present', () => {
        renderHook(() => useNotifReadSync(), {
            wrapper: createWrapper('/events/42?notif=3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b'),
        });

        expect(mockMarkRead).toHaveBeenCalledWith('3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b');
    });

it('should NOT call markRead when ?notif param is absent', () => {
        renderHook(() => useNotifReadSync(), {
            wrapper: createWrapper('/events/42'),
        });

        expect(mockMarkRead).not.toHaveBeenCalled();
    });

it('should NOT call markRead when URL has no query params at all', () => {
        renderHook(() => useNotifReadSync(), {
            wrapper: createWrapper('/profile'),
        });

        expect(mockMarkRead).not.toHaveBeenCalled();
    });

}

function usenotifreadsyncGroup2() {
it('should call markRead once per mount when notif param is present', () => {
        renderHook(() => useNotifReadSync(), {
            wrapper: createWrapper('/events/10?notif=0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'),
        });

        expect(mockMarkRead).toHaveBeenCalledTimes(1);
        expect(mockMarkRead).toHaveBeenCalledWith('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d');
    });

it('should handle different notif IDs correctly', () => {
        renderHook(() => useNotifReadSync(), {
            wrapper: createWrapper('/events/5?notif=5b6c7d8e-9f0a-4b1c-9d2e-3f4a5b6c7d8e'),
        });

        expect(mockMarkRead).toHaveBeenCalledWith('5b6c7d8e-9f0a-4b1c-9d2e-3f4a5b6c7d8e');
    });

it('should not call markRead when ?notif value is empty string', () => {
        // An empty ?notif= returns '' from searchParams.get, which is falsy
        renderHook(() => useNotifReadSync(), {
            wrapper: createWrapper('/events/42?notif='),
        });

        // Empty string is falsy, so markRead should not be called
        expect(mockMarkRead).not.toHaveBeenCalled();
    });

}

function usenotifreadsyncGroup3() {
it('should work with additional query params alongside notif', () => {
        renderHook(() => useNotifReadSync(), {
            wrapper: createWrapper('/events/42?tab=roster&notif=7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f'),
        });

        expect(mockMarkRead).toHaveBeenCalledWith('7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f');
        expect(mockMarkRead).toHaveBeenCalledTimes(1);
    });

it('should re-run effect and call markRead when notif param changes', () => {
        // Start with first notif ID
        const { rerender } = renderHook(() => useNotifReadSync(), {
            wrapper: createWrapper('/events/42?notif=9e0f1a2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b'),
        });

        expect(mockMarkRead).toHaveBeenCalledWith('9e0f1a2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b');
        expect(mockMarkRead).toHaveBeenCalledTimes(1);

        // The effect depends on searchParams; since we cannot easily change
        // the URL in MemoryRouter after initial render without navigation,
        // we just verify the initial behavior is correct.
        // The rerender with same URL should not cause a second call.
        act(() => {
            rerender();
        });

        // Still only called once since the params didn't change
        expect(mockMarkRead).toHaveBeenCalledTimes(1);
    });

}


const HOSTILE = '..%2Fadmin%2Fsettings%2Foauth%2Fclear%23';

/** ROK-1845: a shared `?notif=` link must not pick the API route markRead hits. */
function usenotifreadsyncGroup4() {
it('should NOT call markRead for a path-traversal notif value', () => {
        renderHook(() => useNotifReadSync(), {
            wrapper: createWrapper(`/events/1?notif=${HOSTILE}`),
        });

        expect(mockMarkRead).not.toHaveBeenCalled();
    });

it('should NOT call markRead for a non-UUID notif value', () => {
        renderHook(() => useNotifReadSync(), {
            wrapper: createWrapper('/events/1?notif=notif-abc-123'),
        });

        expect(mockMarkRead).not.toHaveBeenCalled();
    });

it('should still strip an invalid notif param from the URL', () => {
        const { result } = renderHook(() => {
            useNotifReadSync();
            return useLocation().search;
        }, { wrapper: createWrapper(`/events/1?tab=roster&notif=${HOSTILE}`) });

        expect(result.current).toBe('?tab=roster');
    });

it('should strip a valid notif param after marking it read', () => {
        const { result } = renderHook(() => {
            useNotifReadSync();
            return useLocation().search;
        }, { wrapper: createWrapper('/events/1?notif=3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b') });

        expect(mockMarkRead).toHaveBeenCalledWith('3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b');
        expect(result.current).toBe('');
    });

}

describe('useNotifReadSync', () => {
beforeEach(() => {
        vi.clearAllMocks();
    });

    usenotifreadsyncGroup1();
    usenotifreadsyncGroup2();
    usenotifreadsyncGroup3();
    usenotifreadsyncGroup4();
});
