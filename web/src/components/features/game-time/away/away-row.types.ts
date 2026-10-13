/**
 * Row model for the away list (ROK-1585, ROK-1595 S1).
 *
 * `source` decides the row's action: manual rows come from the viewer's own
 * absences and are Removed; calendar rows are derived by read sync and can
 * only be Ignored (DELETE on one is a 409 `use_ignore`).
 */
import type { CalendarProvider } from '@raid-ledger/contract';

/** Where an away row came from. */
export type AwaySource = 'manual' | 'calendar';

/** One row in the upcoming list. */
export interface AwayRowItem {
    key: string;
    /** Absence id; null for rows that have no server record. */
    id: number | null;
    startDate: string;
    endDate: string;
    reason: string | null;
    source: AwaySource;
    /** The calendar a `calendar` row was read from; null for manual rows. */
    provider: CalendarProvider | null;
}

/** The absence fields a row is built from (the API's `GameTimeAbsence`). */
export interface AbsenceInput {
    id: number;
    startDate: string;
    endDate: string;
    reason?: string | null;
    source?: AwaySource | undefined;
    provider?: CalendarProvider | undefined;
}

/**
 * Map API absences to rows (order preserved). A payload without `source` is a
 * manual absence (the field is additive, ROK-1593). ROK-1595 D4: this used to
 * force every row to `manual`, so a synced row offered Remove and got a 409.
 */
export function toAwayRows(absences: readonly AbsenceInput[]): AwayRowItem[] {
    return absences.map((a) => {
        const source: AwaySource = a.source ?? 'manual';
        return {
            key: `${source}-${a.id}`,
            id: a.id,
            startDate: a.startDate,
            endDate: a.endDate,
            reason: a.reason ?? null,
            source,
            provider: source === 'calendar' ? a.provider ?? null : null,
        };
    });
}
