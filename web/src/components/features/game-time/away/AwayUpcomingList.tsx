/**
 * Upcoming away rows (ROK-1585), grouped by source: manual absences under the
 * caller's heading with Remove, calendar rows (ROK-669 seam) under "From your
 * calendars" with Ignore. Remove uses the light-remapped danger text only — no
 * red fills or borders (operator Q11).
 */
import type { JSX } from 'react';
import { awayRangeLabel, awayRowMeta } from './away-panel.helpers';
import type { AwayRowItem } from './away-row.types';

const DEFAULT_EMPTY = 'No time away booked. Pick the days below and polls stop counting you as free on them.';
const LABEL_CLS = 'text-xs font-medium text-muted';
const ROW_BTN = 'min-h-[44px] shrink-0 px-2 text-sm font-medium transition-colors disabled:opacity-50';

interface RowHandlers {
    onRemove: (row: AwayRowItem) => void;
    onIgnore?: (row: AwayRowItem) => void;
    isDeleting: boolean;
}

function RowAction({ row, label, onRemove, onIgnore, isDeleting }: RowHandlers & { row: AwayRowItem; label: string }): JSX.Element | null {
    if (row.source === 'manual') {
        return (
            <button type="button" data-testid="away-row-remove" aria-label={`Remove ${label}`}
                disabled={isDeleting} onClick={() => onRemove(row)} className={`${ROW_BTN} text-red-400 hover:underline`}>
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
    return (
        <div data-testid="away-row" data-source={row.source}
            className="flex min-h-[52px] items-center gap-3 rounded-xl border border-edge bg-panel px-3 py-1.5">
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-foreground">{label}</span>
                <span className="truncate text-xs text-dim">{awayRowMeta(row.startDate, row.endDate, row.reason)}</span>
            </div>
            <RowAction row={row} label={label} {...handlers} />
        </div>
    );
}

/** The list: manual rows (or the empty box) then, when present, calendar rows. */
export function AwayUpcomingList({ rows, heading, emptyText = DEFAULT_EMPTY, ...handlers }: RowHandlers & {
    rows: AwayRowItem[]; heading?: string; emptyText?: string;
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
                <div className="flex flex-col gap-2">
                    <p className={LABEL_CLS}>From your calendars</p>
                    {calendar.map((row) => <AwayRow key={row.key} row={row} {...handlers} />)}
                </div>
            )}
        </div>
    );
}
