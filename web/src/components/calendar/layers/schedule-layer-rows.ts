/**
 * ROK-1775 — interleave a day's events with its layer entries by time for the
 * Schedule (phone list) view. On a tie the layer row comes first: it is context
 * ("the server restarts at 8:00") for the event that starts with it.
 */
import type { LayerDayEntry } from './calendar-layer-days';

export type ScheduleRow<E> =
    | { kind: 'layer'; key: string; at: number; entry: LayerDayEntry }
    | { kind: 'event'; key: string; at: number; event: E };

export function mergeScheduleRows<E extends { id: number; start: Date }>(
    events: readonly E[],
    entries: readonly LayerDayEntry[] = [],
): ScheduleRow<E>[] {
    const rows: ScheduleRow<E>[] = [
        ...entries.map((entry): ScheduleRow<E> => ({ kind: 'layer', key: `l-${entry.id}`, at: entry.at.getTime(), entry })),
        ...events.map((event): ScheduleRow<E> => ({ kind: 'event', key: `e-${event.id}`, at: event.start.getTime(), event })),
    ];
    // Array.prototype.sort is stable, so equal times keep layer-before-event.
    return rows.sort((a, b) => a.at - b.at);
}
