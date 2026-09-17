/**
 * ROK-1588 — the desktop week view's visible-hours window: CHECK_HOURS by
 * default, "Show earlier" / "Show later" bands, auto-opened for required hours.
 */
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { CHECK_HOURS } from '../../phone/phone-week-check.helpers';
import { useWeekHours } from '../use-week-hours';

const EARLIER = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const LATER = [0, 1, 2, 3, 4, 5];

describe('useWeekHours', () => {
    it('defaults to CHECK_HOURS with both bands closed', () => {
        const { result } = renderHook(() => useWeekHours([]));
        expect(result.current.hours).toEqual(CHECK_HOURS);
        expect(result.current.earlier.open).toBe(false);
        expect(result.current.later.open).toBe(false);
        expect(result.current.earlier.label).toBe('▴ Show earlier');
        expect(result.current.later.label).toBe('▾ Show later');
    });

    it('Show earlier prepends 6 AM – 4 PM and flips the label', () => {
        const { result } = renderHook(() => useWeekHours([]));
        act(() => result.current.earlier.toggle());
        expect(result.current.hours).toEqual([...EARLIER, ...CHECK_HOURS]);
        expect(result.current.earlier.open).toBe(true);
        expect(result.current.earlier.label).toBe('▴ Hide earlier');
    });

    it('Show later appends 12 AM – 5 AM after the evening', () => {
        const { result } = renderHook(() => useWeekHours([]));
        act(() => result.current.later.toggle());
        expect(result.current.hours).toEqual([...CHECK_HOURS, ...LATER]);
        expect(result.current.later.label).toBe('▾ Hide later');
    });

    it('orders both bands earlier → base → later', () => {
        const { result } = renderHook(() => useWeekHours([]));
        act(() => result.current.earlier.toggle());
        act(() => result.current.later.toggle());
        expect(result.current.hours).toEqual([...EARLIER, ...CHECK_HOURS, ...LATER]);
    });

    it('auto-opens the later band for a required 2 AM hour', () => {
        const { result } = renderHook(() => useWeekHours([{ hour: 2 }]));
        expect(result.current.later.open).toBe(true);
        expect(result.current.earlier.open).toBe(false);
        expect(result.current.hours).toContain(2);
    });

    it('auto-opens the earlier band for a required 9 AM hour', () => {
        const { result } = renderHook(() => useWeekHours([{ hour: 9 }]));
        expect(result.current.earlier.open).toBe(true);
    });

    it('a required hour inside the base window opens nothing', () => {
        const { result } = renderHook(() => useWeekHours([{ hour: 20 }]));
        expect(result.current.earlier.open).toBe(false);
        expect(result.current.later.open).toBe(false);
    });

    it('an auto-opened band can still be hidden', () => {
        const { result } = renderHook(() => useWeekHours([{ hour: 2 }]));
        act(() => result.current.later.toggle());
        expect(result.current.later.open).toBe(false);
        expect(result.current.hours).not.toContain(2);
    });
});
