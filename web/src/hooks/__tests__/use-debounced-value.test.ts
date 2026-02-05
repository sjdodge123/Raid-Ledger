import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useDebouncedValue } from '../use-debounced-value';

describe('useDebouncedValue', () => {
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

        // Update the value
        rerender({ value: 'updated' });

        // Value should not have changed yet
        expect(result.current).toBe('initial');

        // Fast-forward past the debounce delay
        act(() => {
            vi.advanceTimersByTime(300);
        });

        // Now the value should be updated
        expect(result.current).toBe('updated');
    });

    it('should reset timer on rapid updates', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebouncedValue(value, 300),
            { initialProps: { value: 'initial' } }
        );

        // Rapid updates
        rerender({ value: 'update1' });
        act(() => vi.advanceTimersByTime(100));

        rerender({ value: 'update2' });
        act(() => vi.advanceTimersByTime(100));

        rerender({ value: 'update3' });
        act(() => vi.advanceTimersByTime(100));

        // Still showing initial value (timer keeps resetting)
        expect(result.current).toBe('initial');

        // Complete the final debounce
        act(() => vi.advanceTimersByTime(300));

        // Should show the final value
        expect(result.current).toBe('update3');
    });

    it('should use default delay of 300ms', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebouncedValue(value),
            { initialProps: { value: 'initial' } }
        );

        rerender({ value: 'updated' });

        // At 299ms, value should not have changed
        act(() => vi.advanceTimersByTime(299));
        expect(result.current).toBe('initial');

        // At 300ms, value should change
        act(() => vi.advanceTimersByTime(1));
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
