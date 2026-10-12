/**
 * The ONE absence hook behind every "I'm away" surface (ROK-1585).
 *
 * Split so each piece stays small: `useAwayForm` owns the draft range + note,
 * `useAwayMutations` owns create / delete and their Undo toasts, and
 * `useAwayIgnore` dismisses a synced calendar row (ROK-1595 S1), and
 * `useAbsenceSection` joins them with the upcoming rows. There is no `show`
 * flag — the panel is always open wherever it is mounted.
 */
import { useCallback, useMemo, useState } from 'react';
import { useCreateAbsence, useDeleteAbsence, useGameTimeAbsences, useIgnoreAbsence } from '../../../../hooks/use-game-time';
import { useCalendarsOverview } from '../../../../hooks/use-calendar-sync';
import { useToday } from './use-today';
import { toast } from '../../../../lib/toast';
import { quickRange, spanDays, spanLabel } from '../absence-dates.utils';
import { awayRangeLabel, newestReadSync, syncedAgoLabel, upcomingAbsences, type AwayPick } from './away-panel.helpers';
import { toAwayRows, type AwayRowItem } from './away-row.types';

/** The add form's draft. */
export interface AwayFormState {
    startDate: string;
    endDate: string;
    reason: string;
    noteOpen: boolean;
}

const EMPTY_FORM: AwayFormState = { startDate: '', endDate: '', reason: '', noteOpen: false };

/**
 * Sonner draws its action button 24px tall; on a phone the Undo is the only way
 * back from a mis-tap, so it gets the 44px touch floor (ROK-1585 AC5). The floor
 * is an invisible hit area (24px + 10px above and below): a 44px-tall button
 * looked out of place inside the toast (operator plan note, step 5).
 */
export const UNDO_HIT_AREA_CLASS = "relative after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-['']";

/** The toast options for an Undo action. */
function undoToast(onClick: () => void) {
    return { action: { label: 'Undo', onClick }, classNames: { actionButton: UNDO_HIT_AREA_CLASS } };
}

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
        const input = { startDate: range.startDate, endDate: range.endDate, ...(range.reason ? { reason: range.reason } : {}) };
        try {
            const created = await create.mutateAsync(input);
            const undo = undoToast(() => del.mutate(created.id, { onError: undoFailed }));
            toast.success(`Away ${awayRangeLabel(range.startDate, range.endDate)}`, undo);
            return true;
        } catch {
            toast.error('Could not add your time away');
            return false;
        }
    }, [create, del, undoFailed]);

    const remove = useCallback((row: AwayRowItem) => {
        if (row.id === null) return;
        const recreate = { startDate: row.startDate, endDate: row.endDate, ...(row.reason == null ? {} : { reason: row.reason }) };
        const label = awayRangeLabel(row.startDate, row.endDate);
        del.mutate(row.id, {
            onSuccess: () => toast.success(`Removed ${label}`, undoToast(() => create.mutate(recreate, { onError: undoFailed }))),
            onError: () => { toast.error('Could not remove your time away'); },
        });
    }, [create, del, undoFailed]);

    return { add, remove, isPending: create.isPending, isDeleting: del.isPending };
}

/**
 * Ignore a synced calendar row (ROK-1595 S1). Calendar days are never Removed
 * (DELETE is a 409 `use_ignore`). `useIgnoreAbsence` hides the row at once and
 * restores it on failure; F-9: no Undo — there is no un-ignore route.
 */
function useAwayIgnore() {
    const ignoreAbsence = useIgnoreAbsence();
    return useCallback((row: AwayRowItem) => {
        if (row.id === null || row.source !== 'calendar') return;
        const label = awayRangeLabel(row.startDate, row.endDate);
        ignoreAbsence.mutate(row.id, {
            onSuccess: () => { toast.success(`Ignored ${label}`); },
            onError: () => { toast.error('Could not ignore that day'); },
        });
    }, [ignoreAbsence]);
}

/** "Synced N min ago" for the calendar group; null with the kill switch off or no sync yet. */
function useCalendarSyncedText(): string | null {
    const { data } = useCalendarsOverview();
    return syncedAgoLabel(newestReadSync(data), Date.now());
}

/** Form + mutations + upcoming rows for the away panel. */
export function useAbsenceSection() {
    const today = useToday();
    const { form, patch, pick, reset } = useAwayForm(today);
    const { add, remove, isPending, isDeleting } = useAwayMutations();
    const ignore = useAwayIgnore();
    const syncedText = useCalendarSyncedText();
    const { data } = useGameTimeAbsences();
    const rows = useMemo(() => toAwayRows(upcomingAbsences(data ?? [], today)), [data, today]);

    const span = spanDays(form.startDate, form.endDate);
    const canSubmit = span > 0 && !isPending;
    const submit = useCallback(async (): Promise<void> => {
        if (!canSubmit) return;
        const ok = await add({ startDate: form.startDate, endDate: form.endDate, reason: form.reason.trim() || null });
        if (ok) reset();
    }, [add, canSubmit, form, reset]);

    return {
        form, patch, pick, span, spanText: spanLabel(form.startDate, form.endDate),
        canSubmit, submit, remove, ignore, syncedText, isPending, isDeleting, rows, today,
    };
}

/** What `AwayPanel` and friends take as `ctl`. */
export type AbsenceSectionCtl = ReturnType<typeof useAbsenceSection>;
