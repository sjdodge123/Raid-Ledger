/**
 * ROK-1775 — the server-schedule layer where no bands are drawn, for
 * /dev/design-system (§4.22): the REAL Month date header (one muted glyph per day,
 * tooltip lists the day's items) and the REAL Schedule row (muted, wrapping,
 * interleaved with an event card). Check both colour families with the page's
 * side-by-side toggle.
 */
import { useMemo, useRef, type JSX } from 'react';
import { LayerMonthDateHeader } from '../../components/calendar/layers/LayerMonthDateHeader';
import { ScheduleLayerRow } from '../../components/calendar/layers/ScheduleLayerRow';
import { CalendarLayerContext } from '../../components/calendar/layers/calendar-layer-context';
import type { LayerDayEntry } from '../../components/calendar/layers/calendar-layer-days';
import { StateFrame } from './design-system-bits';

const DAY = new Date(2026, 9, 14);
const RESTART: LayerDayEntry = {
    id: 'ds-restart', kind: 'marker', at: new Date(2026, 9, 14, 4, 5),
    tip: { title: 'Restart · Valheim Dedicated · 4:05 AM', detail: 'Online · checked 2 min ago' },
};
const UP: LayerDayEntry = {
    id: 'ds-up', kind: 'window', at: new Date(2026, 9, 14, 18, 0),
    tip: { title: 'Server up · A Very Long Community Server Name · 6:00 PM – 2:00 AM', detail: '' },
};

function MonthCellSample(): JSX.Element {
    const gridRef = useRef<HTMLDivElement | null>(null);
    const value = useMemo(() => ({ markers: [], dayEntries: new Map([['2026-10-14', [RESTART, UP]]]), gridRef }), []);
    return (
        <CalendarLayerContext.Provider value={value}>
            <div ref={gridRef} className="grid grid-cols-2 rounded-md border border-edge bg-surface" data-testid="ds-layer-month-cell">
                <div className="min-h-[84px] border-r border-edge p-2 text-right text-sm text-foreground">
                    <LayerMonthDateHeader label="14" date={DAY} onDrillDown={() => undefined} />
                </div>
                <div className="min-h-[84px] p-2 text-right text-sm text-foreground">
                    <LayerMonthDateHeader label="15" date={new Date(2026, 9, 15)} onDrillDown={() => undefined} />
                </div>
            </div>
        </CalendarLayerContext.Provider>
    );
}

function ScheduleSample(): JSX.Element {
    return (
        <div className="max-w-[375px] space-y-2 rounded-md border border-edge bg-backdrop p-2" data-testid="ds-layer-schedule-rows">
            <ScheduleLayerRow entry={RESTART} />
            <div className="rounded-lg border border-edge bg-surface p-3 text-sm font-semibold text-foreground">Valheim Night · 8:00 PM</div>
            <ScheduleLayerRow entry={UP} />
        </div>
    );
}

export function CalendarLayerViewFrames(): JSX.Element {
    return (
        <>
            <StateFrame label="Month · LayerMonthDateHeader" note="One glyph on a day with any item; tap it for the day's list by time. The 15th has none.">
                <MonthCellSample />
            </StateFrame>
            <StateFrame label="Schedule · ScheduleLayerRow" note="Muted text-dim rows between event cards; they wrap, never truncate.">
                <ScheduleSample />
            </StateFrame>
        </>
    );
}
