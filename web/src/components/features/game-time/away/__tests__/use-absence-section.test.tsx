import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAbsenceSection } from '../use-absence-section';
import type { AwayRowItem } from '../away-row.types';

const m = vi.hoisted(() => ({
    mutateAsync: vi.fn(),
    createMutate: vi.fn(),
    delMutate: vi.fn(),
    absences: [] as Array<{ id: number; startDate: string; endDate: string; reason: string | null }>,
    success: vi.fn(),
    error: vi.fn(),
}));

vi.mock('../../../../../hooks/use-game-time', () => ({
    useCreateAbsence: () => ({ mutateAsync: m.mutateAsync, mutate: m.createMutate, isPending: false }),
    useDeleteAbsence: () => ({ mutate: m.delMutate, isPending: false }),
    useGameTimeAbsences: () => ({ data: m.absences }),
}));
vi.mock('../../../../../lib/toast', () => ({ toast: { success: m.success, error: m.error } }));

const THURSDAY = new Date(2026, 7, 27, 12, 0, 0); // 2026-08-27

type ToastOpts = { action: { label: string; onClick: () => void } };
const lastToastOpts = (): ToastOpts => m.success.mock.calls.at(-1)?.[1] as ToastOpts;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(THURSDAY);
    vi.clearAllMocks();
    m.absences = [];
});
afterEach(() => { vi.useRealTimers(); });

describe('useAbsenceSection — form', () => {
    it('starts empty and cannot submit', () => {
        const { result } = renderHook(() => useAbsenceSection());
        expect(result.current.form).toEqual({ startDate: '', endDate: '', reason: '', noteOpen: false });
        expect(result.current.canSubmit).toBe(false);
        expect(result.current.spanText).toBe('');
    });

    it('pick fills a preset and reports the span; custom clears it', () => {
        const { result } = renderHook(() => useAbsenceSection());
        act(() => result.current.pick('next-week'));
        expect(result.current.form.startDate).toBe('2026-08-31');
        expect(result.current.span).toBe(7);
        expect(result.current.spanText).toBe('7 days');
        expect(result.current.canSubmit).toBe(true);
        act(() => result.current.pick('custom'));
        expect(result.current.form.startDate).toBe('');
        expect(result.current.canSubmit).toBe(false);
    });

    it('cannot submit an inverted range', () => {
        const { result } = renderHook(() => useAbsenceSection());
        act(() => result.current.patch({ startDate: '2026-09-02', endDate: '2026-09-01' }));
        expect(result.current.canSubmit).toBe(false);
    });
});

describe('useAbsenceSection — submit', () => {
    it('creates, resets the form and toasts with an Undo that deletes the created id', async () => {
        m.mutateAsync.mockResolvedValue({ id: 42, startDate: '2026-08-31', endDate: '2026-09-06', reason: null });
        const { result } = renderHook(() => useAbsenceSection());
        act(() => result.current.pick('next-week'));
        await act(() => result.current.submit());

        expect(m.mutateAsync).toHaveBeenCalledWith({ startDate: '2026-08-31', endDate: '2026-09-06', reason: undefined });
        expect(result.current.form.startDate).toBe('');
        expect(m.success).toHaveBeenCalledWith('Away Mon Aug 31 – Sun Sep 6', expect.anything());
        expect(lastToastOpts().action.label).toBe('Undo');
        lastToastOpts().action.onClick();
        expect(m.delMutate).toHaveBeenCalledWith(42, expect.anything());
    });

    it('sends the note when one was typed', async () => {
        m.mutateAsync.mockResolvedValue({ id: 1, startDate: '2026-08-29', endDate: '2026-08-30', reason: 'Lake' });
        const { result } = renderHook(() => useAbsenceSection());
        act(() => result.current.patch({ startDate: '2026-08-29', endDate: '2026-08-30', reason: 'Lake' }));
        await act(() => result.current.submit());
        expect(m.mutateAsync).toHaveBeenCalledWith({ startDate: '2026-08-29', endDate: '2026-08-30', reason: 'Lake' });
    });

    it('does nothing when the range is not submittable', async () => {
        const { result } = renderHook(() => useAbsenceSection());
        await act(() => result.current.submit());
        expect(m.mutateAsync).not.toHaveBeenCalled();
    });

    it('toasts an error and keeps the values when create fails', async () => {
        m.mutateAsync.mockRejectedValue(new Error('500'));
        const { result } = renderHook(() => useAbsenceSection());
        act(() => result.current.pick('weekend'));
        await act(() => result.current.submit());
        expect(m.error).toHaveBeenCalledWith('Could not add your time away');
        expect(result.current.form.startDate).toBe('2026-08-29');
        expect(m.success).not.toHaveBeenCalled();
    });
});

describe('useAbsenceSection — rows and remove', () => {
    it('exposes only upcoming absences as sorted manual rows', () => {
        m.absences = [
            { id: 2, startDate: '2026-10-01', endDate: '2026-10-04', reason: null },
            { id: 1, startDate: '2026-08-01', endDate: '2026-08-02', reason: null },
            { id: 3, startDate: '2026-09-19', endDate: '2026-09-20', reason: 'Lake trip' },
        ];
        const { result } = renderHook(() => useAbsenceSection());
        expect(result.current.rows.map((r) => r.key)).toEqual(['manual-3', 'manual-2']);
        expect(result.current.rows[0].source).toBe('manual');
    });

    it('remove deletes, then toasts with an Undo that re-creates the same range + note', () => {
        const row: AwayRowItem = { key: 'manual-7', id: 7, startDate: '2026-09-19', endDate: '2026-09-20', reason: 'Lake trip', source: 'manual' };
        const { result } = renderHook(() => useAbsenceSection());
        act(() => result.current.remove(row));

        const [id, opts] = m.delMutate.mock.calls[0] as [number, { onSuccess: () => void; onError: () => void }];
        expect(id).toBe(7);
        opts.onSuccess();
        expect(m.success).toHaveBeenCalledWith('Removed Sat Sep 19 – Sun Sep 20', expect.anything());
        lastToastOpts().action.onClick();
        expect(m.createMutate).toHaveBeenCalledWith(
            { startDate: '2026-09-19', endDate: '2026-09-20', reason: 'Lake trip' }, expect.anything());
        opts.onError();
        expect(m.error).toHaveBeenCalledWith('Could not remove your time away');
    });

    it('remove ignores rows without a server id', () => {
        const { result } = renderHook(() => useAbsenceSection());
        act(() => result.current.remove({ key: 'cal-1', id: null, startDate: '2026-09-19', endDate: '2026-09-19', reason: null, source: 'calendar' }));
        expect(m.delMutate).not.toHaveBeenCalled();
    });
});
