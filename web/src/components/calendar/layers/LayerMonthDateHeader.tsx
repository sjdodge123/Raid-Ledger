/**
 * ROK-1775 — react-big-calendar `components.month.dateHeader`: the library's own
 * date label (a drill-down `rbc-button-link`, or a span) plus, on a day with ANY
 * layer item, one muted power glyph whose tooltip lists that day's items by time.
 * No bands at this zoom, and events are untouched. Without a layer context or
 * items it renders exactly the default header.
 */
import { format } from 'date-fns';
import type { JSX, MouseEvent, ReactNode } from 'react';
import { useCalendarLayerContext } from './calendar-layer-context';
import { LayerGlyph } from './LayerGlyph';

export interface LayerMonthDateHeaderProps {
    label: ReactNode;
    date: Date;
    drilldownView?: string | null;
    onDrillDown: (e: MouseEvent) => void;
}

export function LayerMonthDateHeader({ label, date, drilldownView, onDrillDown }: LayerMonthDateHeaderProps): JSX.Element {
    const ctx = useCalendarLayerContext();
    const entries = ctx?.dayEntries.get(format(date, 'yyyy-MM-dd')) ?? [];
    const text = drilldownView
        ? <button type="button" className="rbc-button-link" onClick={onDrillDown}>{label}</button>
        : <span>{label}</span>;
    if (entries.length === 0) return text;
    return (
        <span data-testid="layer-month-day" className="rl-layer-month-day inline-flex items-center gap-1 align-middle">
            <LayerGlyph tips={entries.map((e) => e.tip)} testId="layer-month-glyph" align="below" />
            {text}
        </span>
    );
}
