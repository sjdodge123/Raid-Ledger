/**
 * ROK-2025: the organizer's bench pick — defaults to the latest yes-voters,
 * follows live votes until touched (D7), and the lock-in retries without the
 * pick when the server refuses it (D6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { completeStandalonePoll } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { BENCH_PICKER_ID, benchPickError, completeLockIn, guardBenchPick, useBenchPick, type BenchPick } from './use-bench-pick';
import type { SchedulingOverflow } from './use-scheduling-overflow';
import { withHttpStatus } from '../../lib/api/api-error';

vi.mock('../../lib/api-client', () => ({ completeStandalonePoll: vi.fn() }));
vi.mock('../../lib/toast', () => ({ toast: { warning: vi.fn() } }));

function overflow(ids: number[], benched: number): SchedulingOverflow {
    const people = ids.map((userId) => ({ userId, displayName: `User ${userId}` }));
    return { voters: people.map((p) => p.displayName), people, rostered: 1 + ids.length, cap: 1 + ids.length - benched, benched, creatorVoted: true };
}

const FALLBACK = "Event created, but the votes changed while you were choosing. The latest yes-voters went to the bench. You can move people on the event's roster.";

beforeEach(() => vi.clearAllMocks());

describe('useBenchPick', () => {
    it('pre-marks the latest yes-voters and reports no mismatch', () => {
        const { result } = renderHook(() => useBenchPick(overflow([2, 3, 4, 5], 2)));
        expect(result.current.picked).toEqual([4, 5]);
        expect(result.current.mismatch).toBe(0);
        expect(result.current.benchUserIds).toEqual([4, 5]);
    });

    it('re-derives the default from live votes while untouched', () => {
        const { result, rerender } = renderHook(({ o }) => useBenchPick(o), { initialProps: { o: overflow([2, 3, 4], 1) } });
        expect(result.current.picked).toEqual([4]);
        rerender({ o: overflow([2, 3, 4, 6], 2) });
        expect(result.current.picked).toEqual([4, 6]);
    });

    it('keeps a touched pick, drops people who left, and never auto-adds', () => {
        const { result, rerender } = renderHook(({ o }) => useBenchPick(o), { initialProps: { o: overflow([2, 3, 4, 5], 2) } });
        act(() => result.current.toggle(5));
        act(() => result.current.toggle(2));
        expect(result.current.picked).toEqual([4, 2]);
        rerender({ o: overflow([2, 3, 5, 6, 7], 3) });
        expect(result.current.picked).toEqual([2]);
        expect(result.current.mismatch).toBe(-2);
    });

    it('forgets a touched mark whose voter left, so it is not re-marked when they vote again', () => {
        const { result, rerender } = renderHook(({ o }) => useBenchPick(o), { initialProps: { o: overflow([2, 3, 4, 5], 2) } });
        act(() => result.current.toggle(5));
        act(() => result.current.toggle(3));
        expect(result.current.picked).toEqual([4, 3]);
        rerender({ o: overflow([2, 4, 5], 1) });
        expect(result.current.picked).toEqual([4]);
        rerender({ o: overflow([2, 3, 4, 5], 2) });
        expect(result.current.picked).toEqual([4]);
        expect(result.current.benchUserIds).toEqual([4]);
    });

    it('caps the pick at the voters when the organizer is benched too (0-spot roster)', () => {
        const { result } = renderHook(() => useBenchPick(overflow([2, 3], 3)));
        expect(result.current.need).toBe(2);
        expect(result.current.picked).toEqual([2, 3]);
        expect(result.current.mismatch).toBe(0);
    });

    it('sends no pick and no mismatch without an overflow', () => {
        const { result } = renderHook(() => useBenchPick(null));
        expect(result.current).toMatchObject({ picked: [], mismatch: 0, benchUserIds: undefined });
    });
});

describe('benchPickError', () => {
    it('uses the exact too-few and too-many copy', () => {
        expect(benchPickError(-2, 3)).toBe('Pick 2 more for the bench.');
        expect(benchPickError(1, 2)).toBe('Only 2 can go to the bench. Unmark 1.');
        expect(benchPickError(0, 2)).toBeUndefined();
    });
});

describe('guardBenchPick', () => {
    const bench = (mismatch: number): BenchPick => ({ overflow: overflow([2, 3], 1), picked: [], need: 1, mismatch, benchUserIds: [], toggle: vi.fn() });

    it('blocks the submit and scrolls to the picker on a mismatch', () => {
        const el = document.createElement('fieldset');
        el.id = BENCH_PICKER_ID;
        el.scrollIntoView = vi.fn();
        document.body.appendChild(el);
        expect(guardBenchPick(bench(-1))).toBe(true);
        expect(el.scrollIntoView).toHaveBeenCalled();
        el.remove();
    });

    it('lets a matching pick through without scrolling', () => {
        const el = document.createElement('fieldset');
        el.id = BENCH_PICKER_ID;
        el.scrollIntoView = vi.fn();
        document.body.appendChild(el);
        expect(guardBenchPick(bench(0))).toBe(false);
        expect(el.scrollIntoView).not.toHaveBeenCalled();
        el.remove();
    });
});

describe('completeLockIn', () => {
    it('sends the pick with the event and slot', async () => {
        vi.mocked(completeStandalonePoll).mockResolvedValue(undefined);
        await completeLockIn(5, 77, 'T', [4, 5]);
        expect(completeStandalonePoll).toHaveBeenCalledTimes(1);
        expect(completeStandalonePoll).toHaveBeenCalledWith(5, 77, 'T', [4, 5]);
        expect(toast.warning).not.toHaveBeenCalled();
    });

    it('retries once WITHOUT the pick when the server refuses it (HTTP 400), then warns (D6)', async () => {
        vi.mocked(completeStandalonePoll).mockRejectedValueOnce(withHttpStatus(new Error('The votes changed'), 400)).mockResolvedValueOnce(undefined);
        await completeLockIn(5, 77, 'T', [4]);
        expect(vi.mocked(completeStandalonePoll).mock.calls).toEqual([[5, 77, 'T', [4]], [5, 77, 'T']]);
        expect(toast.warning).toHaveBeenCalledWith(FALLBACK);
    });

    it('rejects when the retry fails too, with no fallback toast', async () => {
        vi.mocked(completeStandalonePoll).mockRejectedValueOnce(withHttpStatus(new Error('The votes changed'), 400)).mockRejectedValueOnce(new Error('gone'));
        await expect(completeLockIn(5, 77, 'T', [4])).rejects.toThrow('gone');
        expect(toast.warning).not.toHaveBeenCalled();
    });

    it.each([
        ['a network failure (no HTTP status)', new TypeError('Failed to fetch')],
        ['a 409', withHttpStatus(new Error('Already completed'), 409)],
        ['a 500', withHttpStatus(new Error('Internal error'), 500)],
    ])('does NOT retry or claim the votes changed on %s', async (_label, failure) => {
        vi.mocked(completeStandalonePoll).mockRejectedValueOnce(failure);
        await expect(completeLockIn(5, 77, 'T', [4])).rejects.toBe(failure);
        expect(vi.mocked(completeStandalonePoll).mock.calls).toEqual([[5, 77, 'T', [4]]]);
        expect(toast.warning).not.toHaveBeenCalled();
    });

    it('never sends a pick without an event, and never retries', async () => {
        vi.mocked(completeStandalonePoll).mockRejectedValue(new Error('x'));
        await expect(completeLockIn(5, undefined, undefined, [4])).rejects.toThrow('x');
        expect(vi.mocked(completeStandalonePoll).mock.calls).toEqual([[5, undefined, undefined]]);
    });
});
