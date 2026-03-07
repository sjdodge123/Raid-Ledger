import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useDebouncedValue } from '../use-debounced-value';

describe('useDebouncedValue — basic behavior', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should return initial value immediately', () => {
        const { result } = renderHook(() => useDebouncedValue('initial', 300));
        expect(result.current).toBe('initial');
    });

    it('should debounce value updates', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebouncedValue(value, 300),
            { initialProps: { value: 'initial' } }
        );

        expect(result.current).toBe('initial');
        rerender({ value: 'updated' });
        expect(result.current).toBe('initial');

        act(() => {
            vi.advanceTimersByTime(300);
        });

        expect(result.current).toBe('updated');
    });

    it('should work with different types', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebouncedValue(value, 100),
            { initialProps: { value: 42 } }
        );

        expect(result.current).toBe(42);

        rerender({ value: 100 });
        act(() => vi.advanceTimersByTime(100));

        expect(result.current).toBe(100);
    });
});

describe('useDebouncedValue — rapid updates and defaults', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should reset timer on rapid updates', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebouncedValue(value, 300),
            { initialProps: { value: 'initial' } }
        );

        rerender({ value: 'update1' });
        act(() => vi.advanceTimersByTime(100));

        rerender({ value: 'update2' });
        act(() => vi.advanceTimersByTime(100));

        rerender({ value: 'update3' });
        act(() => vi.advanceTimersByTime(100));

        expect(result.current).toBe('initial');

        act(() => vi.advanceTimersByTime(300));

        expect(result.current).toBe('update3');
    });

    it('should use default delay of 300ms', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebouncedValue(value),
            { initialProps: { value: 'initial' } }
        );

        rerender({ value: 'updated' });

        act(() => vi.advanceTimersByTime(299));
        expect(result.current).toBe('initial');

        act(() => vi.advanceTimersByTime(1));
        expect(result.current).toBe('updated');
    });
});
