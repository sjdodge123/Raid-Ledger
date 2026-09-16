/**
 * The ONE absence hook behind every "I'm away" surface (ROK-1585).
 *
 * Split so each piece stays small: `useAwayForm` owns the draft range + note,
 * `useAwayMutations` owns create / delete and their Undo toasts, and
 * `useAbsenceSection` joins them with the upcoming rows. There is no `show`
 * flag — the panel is always open wherever it is mounted.
 */
import { useCallback, useMemo, useState } from 'react';
import { useCreateAbsence, useDeleteAbsence, useGameTimeAbsences } from '../../../../hooks/use-game-time';
import { toast } from '../../../../lib/toast';
import { quickRange, spanDays, spanLabel } from '../absence-dates.utils';
import { awayRangeLabel, upcomingAbsences, type AwayPick } from './away-panel.helpers';
import { toManualRows, type AwayRowItem } from './away-row.types';

/** The add form's draft. */
export interface AwayFormState {
    startDate: string;
    endDate: string;
    reason: string;
    noteOpen: boolean;
}

const EMPTY_FORM: AwayFormState = { startDate: '', endDate: '', reason: '', noteOpen: false };

interface AwayRange { startDate: string; endDate: string; reason: string | null }

/** Draft state for the add form: patch fields, apply a quick range, reset. */
function useAwayForm(today: Date) {
    const [form, setForm] = useState<AwayFormState>(EMPTY_FORM);
    const patch = useCallback((p: Partial<AwayFormState>) => setForm((s) => ({ ...s, ...p })), []);
    const pick = useCallback((kind: AwayPick) => {
        patch(kind === 'custom' ? { startDate: '', endDate: '' } : quickRange(kind, today));
    }, [patch, today]);
    const reset = useCallback(() => setForm(EMPTY_FORM), []);
    return { form, patch, pick, reset };
}

/** Create / delete with the Undo toasts; each Undo is the inverse mutation. */
function useAwayMutations() {
    const create = useCreateAbsence();
    const del = useDeleteAbsence();
    const undoFailed = useCallback(() => toast.error('Could not undo'), []);

    const add = useCallback(async (range: AwayRange): Promise<boolean> => {
        const input = { startDate: range.startDate, endDate: range.endDate, reason: range.reason || undefined };
        try {
            const created = await create.mutateAsync(input);
            toast.success(`Away ${awayRangeLabel(range.startDate, range.endDate)}`, {
                action: { label: 'Undo', onClick: () => del.mutate(created.id, { onError: undoFailed }) },
            });
            return true;
        } catch {
            toast.error('Could not add your time away');
            return false;
        }
    }, [create, del, undoFailed]);

    const remove = useCallback((row: AwayRowItem) => {
        if (row.id === null) return;
        const recreate = { startDate: row.startDate, endDate: row.endDate, reason: row.reason ?? undefined };
        del.mutate(row.id, {
            onSuccess: () => toast.success(`Removed ${awayRangeLabel(row.startDate, row.endDate)}`, {
                action: { label: 'Undo', onClick: () => create.mutate(recreate, { onError: undoFailed }) },
            }),
            onError: () => { toast.error('Could not remove your time away'); },
        });
    }, [create, del, undoFailed]);

    return { add, remove, isPending: create.isPending, isDeleting: del.isPending };
}

/** Form + mutations + upcoming rows for the away panel. */
export function useAbsenceSection() {
    const today = useMemo(() => new Date(), []);
    const { form, patch, pick, reset } = useAwayForm(today);
    const { add, remove, isPending, isDeleting } = useAwayMutations();
    const { data } = useGameTimeAbsences();
    const rows = useMemo(() => toManualRows(upcomingAbsences(data ?? [], today)), [data, today]);

    const span = spanDays(form.startDate, form.endDate);
    const canSubmit = span > 0 && !isPending;
    const submit = useCallback(async (): Promise<void> => {
        if (!canSubmit) return;
        const ok = await add({ startDate: form.startDate, endDate: form.endDate, reason: form.reason.trim() || null });
        if (ok) reset();
    }, [add, canSubmit, form, reset]);

    return {
        form, patch, pick, span, spanText: spanLabel(form.startDate, form.endDate),
        canSubmit, submit, remove, isPending, isDeleting, rows, today,
    };
}

/** What `AwayPanel` and friends take as `ctl`. */
export type AbsenceSectionCtl = ReturnType<typeof useAbsenceSection>;
