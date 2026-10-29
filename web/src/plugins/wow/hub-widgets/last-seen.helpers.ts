/**
 * ROK-1916 (W9) — pure copy helpers for the "Last seen" card. Day counts are
 * relative to the roster export, never to now (spec Q3): 0 = offline under a
 * day before the export → "today".
 */

/** Rows shown per section (operator ruling Q1). */
export const LAST_SEEN_ROWS = 5;

/** "today" for under a day offline, otherwise "N d". */
export function awayLabel(days: number): string {
    return days === 0 ? 'today' : `${days} d`;
}

/** The tooltip on an away row's day count. */
export function awayTitle(days: number): string {
    if (days === 0) return 'Offline less than a day before the export';
    return `Last online ${days} ${days === 1 ? 'day' : 'days'} before the export`;
}
