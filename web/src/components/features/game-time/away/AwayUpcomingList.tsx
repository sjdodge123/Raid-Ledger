/**
 * Upcoming away rows (ROK-1585), grouped by source: manual absences under the
 * caller's heading with Remove, synced calendar rows (ROK-1595 S1) under a
 * "From your calendars · Synced N min ago" divider with Ignore — never Remove.
 * Remove uses the light-remapped danger text only — no red fills or borders
 * (operator Q11).
 *
 * Synced rows are "visually quiet" (S1; styling not captured in the mirror,
 * spec F-6): a hairline `border-edge-subtle` on no fill and a `text-muted`
 * title, so the viewer's own bookings stay the loudest thing in the list.
 */
import type { JSX } from 'react';
import { awayRangeLabel, rowMeta } from './away-panel.helpers';
import type { AwayRowItem } from './away-row.types';

const DEFAULT_EMPTY = 'No time away booked. Pick the days below and polls stop counting you as free on them.';
const LABEL_CLS = 'text-xs font-medium text-muted';
const ROW_BTN = 'min-h-[44px] shrink-0 px-2 text-sm font-medium transition-colors disabled:opacity-50';
const ROW_BASE = 'flex min-h-[52px] items-center gap-3 rounded-xl border px-3 py-1.5';
/** Manual row = a panel card; synced row = quiet (hairline, no fill, muted title). */
const ROW_TONE = {
    manual: { box: 'border-edge bg-panel', title: 'font-semibold text-foreground' },
    calendar: { box: 'border-edge-subtle bg-transparent', title: 'font-medium text-muted' },
} as const;

interface RowHandlers {
    onRemove: (row: AwayRowItem) => void;
    onIgnore?: (row: AwayRowItem) => void;
    isDeleting: boolean;
}

function RowAction({ row, label, onRemove, onIgnore, isDeleting }: RowHandlers & { row: AwayRowItem; label: string }): JSX.Element | null {
    if (row.source === 'manual') {
        return (
            <button type="button" data-testid="away-row-remove" aria-label={`Remove ${label}`}
                disabled={isDeleting} onClick={() => onRemove(row)} className={`${ROW_BTN} text-danger hover:underline`}>
                Remove
            </button>
        );
    }
    if (!onIgnore) return null;
    return (
        <button type="button" data-testid="away-row-ignore" aria-label={`Ignore ${label}`}
            onClick={() => onIgnore(row)} className={`${ROW_BTN} text-muted hover:text-foreground`}>
            Ignore
        </button>
    );
}

function AwayRow({ row, ...handlers }: RowHandlers & { row: AwayRowItem }): JSX.Element {
    const label = awayRangeLabel(row.startDate, row.endDate);
    const tone = ROW_TONE[row.source];
    return (
        <div data-testid="away-row" data-source={row.source} className={`${ROW_BASE} ${tone.box}`}>
            <div className="flex min-w-0 flex-1 flex-col">
                <span className={`truncate text-sm ${tone.title}`}>{label}</span>
                <span data-testid="away-row-meta" className="truncate text-xs text-dim">{rowMeta(row)}</span>
            </div>
            <RowAction row={row} label={label} {...handlers} />
        </div>
    );
}

/** "From your calendars" on a hairline, "Synced N min ago" on the right (hidden without a sync time). */
function CalendarDivider({ syncedText }: { syncedText: string | null | undefined }): JSX.Element {
    return (
        <div data-testid="away-calendar-divider" className="flex items-baseline justify-between gap-2 border-t border-edge-subtle pt-3">
            <p className={LABEL_CLS}>From your calendars</p>
            {syncedText && <span data-testid="away-calendar-synced" className="text-xs text-dim">{syncedText}</span>}
        </div>
    );
}

/** The list: manual rows (or the empty box) then, when present, calendar rows. */
export function AwayUpcomingList({ rows, heading, emptyText = DEFAULT_EMPTY, syncedText, ...handlers }: RowHandlers & {
    rows: AwayRowItem[]; heading?: string | undefined; emptyText?: string | undefined;
    /** "Synced 4 min ago" beside the calendar group's label. */
    syncedText?: string | null | undefined;
}): JSX.Element {
    const manual = rows.filter((r) => r.source === 'manual');
    const calendar = rows.filter((r) => r.source === 'calendar');
    return (
        <div data-testid="away-upcoming" className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                {heading && <p className={LABEL_CLS}>{heading}</p>}
                {manual.length === 0
                    ? <div data-testid="away-empty" className="rounded-xl border border-dashed border-edge p-3.5 text-sm text-muted">{emptyText}</div>
                    : manual.map((row) => <AwayRow key={row.key} row={row} {...handlers} />)}
            </div>
            {calendar.length > 0 && (
                <div data-testid="away-calendar-group" className="flex flex-col gap-2">
                    <CalendarDivider syncedText={syncedText} />
                    {calendar.map((row) => <AwayRow key={row.key} row={row} {...handlers} />)}
                </div>
            )}
        </div>
    );
}
