/**
 * Row model for the away list (ROK-1585).
 *
 * `source` is the calendar seam (AC8, ROK-669): manual rows come from the
 * absences API and can be removed; calendar rows would come from a synced
 * calendar and can only be ignored. No calendar source exists yet.
 */

/** Where an away row came from. */
export type AwaySource = 'manual' | 'calendar';

/** One row in the upcoming list. */
export interface AwayRowItem {
    key: string;
    /** Absence id for manual rows; null for rows that have no server record. */
    id: number | null;
    startDate: string;
    endDate: string;
    reason: string | null;
    source: AwaySource;
}

/** The absence fields a manual row is built from. */
export interface AbsenceInput {
    id: number;
    startDate: string;
    endDate: string;
    reason?: string | null;
}

/** Map API absences to manual rows (order preserved). */
export function toManualRows(absences: readonly AbsenceInput[]): AwayRowItem[] {
    return absences.map((a) => ({
        key: `manual-${a.id}`,
        id: a.id,
        startDate: a.startDate,
        endDate: a.endDate,
        reason: a.reason ?? null,
        source: 'manual',
    }));
}
