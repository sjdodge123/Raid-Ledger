import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNow } from './use-now';

afterEach(() => {
    vi.useRealTimers();
});

describe('useNow', () => {
    it('advances on each interval and stops once unmounted', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
        const { result, unmount } = renderHook(() => useNow(60_000));
        const start = result.current;
        act(() => {
            vi.advanceTimersByTime(60_000);
        });
        expect(result.current - start).toBe(60_000);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
