import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CalendarConnection, CalendarsOverview, GameTimeAbsence } from '@raid-ledger/contract';
import { act, renderHook } from '@testing-library/react';
import { UNDO_HIT_AREA_CLASS, useAbsenceSection } from '../use-absence-section';
import type { AwayRowItem } from '../away-row.types';

const m = vi.hoisted(() => ({
    ignoreMutate: vi.fn(),
    overview: undefined as CalendarsOverview | undefined,
    mutateAsync: vi.fn(),
    createMutate: vi.fn(),
    delMutate: vi.fn(),
    absences: [] as GameTimeAbsence[],
    success: vi.fn(),
    error: vi.fn(),
}));

vi.mock('../../../../../hooks/use-game-time', () => ({
    useCreateAbsence: () => ({ mutateAsync: m.mutateAsync, mutate: m.createMutate, isPending: false }),
    useDeleteAbsence: () => ({ mutate: m.delMutate, isPending: false }),
    useGameTimeAbsences: () => ({ data: m.absences }),
    useIgnoreAbsence: () => ({ mutate: m.ignoreMutate, isPending: false }),
}));
vi.mock('../../../../../hooks/use-calendar-sync', () => ({ useCalendarsOverview: () => ({ data: m.overview }) }));
vi.mock('../../../../../lib/toast', () => ({ toast: { success: m.success, error: m.error } }));

const THURSDAY = new Date(2026, 7, 27, 12, 0, 0); // 2026-08-27

type ToastOpts = { action: { label: string; onClick: () => void } };
const lastToastOpts = (): ToastOpts => m.success.mock.calls.at(-1)?.[1] as ToastOpts;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(THURSDAY);
    vi.clearAllMocks();
    m.absences = [];
    m.overview = undefined;
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

type UndoOpts = { actionButtonStyle?: { minHeight?: number }; classNames?: { actionButton?: string } };

/** 24px button + 10px (-inset-y-2.5) above and below = 44px; the button itself stays compact. */
function expectUndoHitArea(opts: UndoOpts): void {
    expect(opts.classNames?.actionButton).toBe(UNDO_HIT_AREA_CLASS);
    expect(opts.classNames?.actionButton).toContain('after:-inset-y-2.5');
    expect(opts.actionButtonStyle?.minHeight).toBeUndefined();
}

describe('useAbsenceSection — the Undo action is a touch target (ROK-1585 AC5)', () => {
    it('gives the add AND remove toasts an Undo with a 44px hit area and no oversized button', async () => {
        m.mutateAsync.mockResolvedValue({ id: 42, startDate: '2026-08-31', endDate: '2026-09-06', reason: null });
        const { result } = renderHook(() => useAbsenceSection());
        act(() => result.current.pick('next-week'));
        await act(() => result.current.submit());
        const addOpts = m.success.mock.calls.at(-1)?.[1] as UndoOpts;
        expectUndoHitArea(addOpts);

        const row: AwayRowItem = { key: 'manual-7', id: 7, startDate: '2026-09-19', endDate: '2026-09-20', reason: null, source: 'manual', provider: null };
        act(() => result.current.remove(row));
        const [, opts] = m.delMutate.mock.calls.at(-1) as [number, { onSuccess: () => void }];
        opts.onSuccess();
        const removeOpts = m.success.mock.calls.at(-1)?.[1] as UndoOpts;
        expectUndoHitArea(removeOpts);
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
        expect(result.current.rows[0]?.source).toBe('manual');
    });

    it('remove deletes, then toasts with an Undo that re-creates the same range + note', () => {
        const row: AwayRowItem = { key: 'manual-7', id: 7, startDate: '2026-09-19', endDate: '2026-09-20', reason: 'Lake trip', source: 'manual', provider: null };
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
        act(() => result.current.remove({ key: 'cal-1', id: null, startDate: '2026-09-19', endDate: '2026-09-19', reason: null, source: 'calendar', provider: null }));
        expect(m.delMutate).not.toHaveBeenCalled();
    });
});

/* ── ROK-1595 S1: synced calendar rows ─────────────────────────────────── */

const synced: GameTimeAbsence = { id: 12, startDate: '2026-10-16', endDate: '2026-10-16', reason: null, source: 'calendar', provider: 'google' };
const calRow: AwayRowItem = { key: 'calendar-12', id: 12, startDate: '2026-10-16', endDate: '2026-10-16', reason: null, source: 'calendar', provider: 'google' };

function overviewWith(over: Partial<CalendarConnection>, enabled = true): CalendarsOverview {
    const conn: CalendarConnection = {
        id: 7, provider: 'google', accountLabel: null, status: 'active', lastSyncedAt: null, errorCode: null,
        read: { enabled: true, calendarIds: [] }, write: { enabled: false, target: 'dedicated' }, ...over,
    };
    return { enabled, providers: { google: { available: true }, microsoft: { available: false }, apple: { available: false } },
        connections: [conn], readSettings: { mode: 'both', lookAheadWeeks: 4 }, feed: null };
}

describe('useAbsenceSection — synced calendar rows (ROK-1595 S1)', () => {
    it('keeps a synced absence a calendar row (D4: it used to be forced to manual)', () => {
        m.absences = [synced, { id: 3, startDate: '2026-09-19', endDate: '2026-09-20', reason: null }];
        const { result } = renderHook(() => useAbsenceSection());
        expect(result.current.rows.map((r) => [r.key, r.source, r.provider])).toEqual([
            ['manual-3', 'manual', null], ['calendar-12', 'calendar', 'google'],
        ]);
    });

    it('ignore posts the row id, toasts "Ignored …" with no Undo (F-9), and toasts on failure', () => {
        const { result } = renderHook(() => useAbsenceSection());
        act(() => result.current.ignore(calRow));
        const [id, opts] = m.ignoreMutate.mock.calls[0] as [number, { onSuccess: () => void; onError: () => void }];
        expect(id).toBe(12);
        opts.onSuccess();
        expect(m.success).toHaveBeenCalledWith('Ignored Fri Oct 16');
        expect(m.success.mock.calls.at(-1)).toHaveLength(1);
        opts.onError();
        expect(m.error).toHaveBeenCalledWith('Could not ignore that day');
    });

    it('never ignores a manual row or a row without a server id', () => {
        const { result } = renderHook(() => useAbsenceSection());
        act(() => result.current.ignore({ ...calRow, source: 'manual', provider: null }));
        act(() => result.current.ignore({ ...calRow, id: null }));
        expect(m.ignoreMutate).not.toHaveBeenCalled();
    });

    it('reads "Synced N min ago" off the newest reading connection; null with the kill switch off', () => {
        const fourMinAgo = new Date(THURSDAY.getTime() - 4 * 60_000).toISOString();
        m.overview = overviewWith({ lastSyncedAt: fourMinAgo });
        const { result, rerender } = renderHook(() => useAbsenceSection());
        expect(result.current.syncedText).toBe('Synced 4 min ago');
        m.overview = overviewWith({ lastSyncedAt: fourMinAgo }, false);
        rerender();
        expect(result.current.syncedText).toBeNull();
        m.overview = overviewWith({ lastSyncedAt: fourMinAgo, read: { enabled: false, calendarIds: [] } });
        rerender();
        expect(result.current.syncedText).toBeNull();
        m.overview = overviewWith({ lastSyncedAt: new Date(THURSDAY.getTime() - 2 * 3_600_000).toISOString() });
        rerender();
        expect(result.current.syncedText).toBe('Synced 2 h ago');
    });
});
