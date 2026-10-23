import type { CommunityTemporalResponseDto } from '@raid-ledger/contract';
import {
    WEEKDAY_LABELS, PEAK_MARK, buildPeakMap, cellKey, peakCellLabel,
} from './temporal-heatmap.utils';

interface Props {
    heatmap: CommunityTemporalResponseDto['heatmap'];
    peakHours: CommunityTemporalResponseDto['peakHours'];
}

/**
 * Keyboard focus is an outline (outside the cell) so it never repaints the
 * inset `PEAK_MARK` box-shadow ring — a focused peak keeps both marks.
 */
const CELL_BASE =
    'h-5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-success';

/**
 * 7 × 24 activity heatmap. Cell shade is a percentile over the max
 * activity cell in the snapshot; each cell is keyboard-focusable with an
 * `aria-label` spelling out the weekday / hour / activity count. Each
 * weekday's top hours (`peakHours`) carry the inset `PEAK_MARK` ring and a
 * "Sat 9pm · 17 sessions" title (ROK-1936).
 */
export function TemporalHeatmap({ heatmap, peakHours }: Props) {
    if (heatmap.length === 0) {
        return <Empty />;
    }
    const max = Math.max(1, ...heatmap.map((c) => c.activity));
    const byCell = new Map(heatmap.map((c) => [cellKey(c.weekday, c.hour), c.activity]));
    const peaks = buildPeakMap(peakHours);

    return (
        <div className="overflow-x-auto" data-testid="temporal-heatmap">
            <div className="grid" style={{ gridTemplateColumns: '3rem repeat(24, minmax(1.25rem, 1fr))' }}>
                <div className="text-xs text-muted" />
                {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="text-[10px] text-muted text-center">{h}</div>
                ))}
                {WEEKDAY_LABELS.map((label, idx) => (
                    <WeekdayRow key={label} label={label} weekday={idx + 1} max={max} byCell={byCell} peaks={peaks} />
                ))}
            </div>
        </div>
    );
}

function WeekdayRow({ label, weekday, max, byCell, peaks }: {
    label: string; weekday: number; max: number; byCell: Map<string, number>; peaks: Map<string, number>;
}) {
    return (
        <>
            <div className="text-xs text-muted flex items-center pr-2">{label}</div>
            {Array.from({ length: 24 }, (_, hour) => (
                <HeatCell
                    key={hour}
                    label={label}
                    hour={hour}
                    activity={byCell.get(cellKey(weekday, hour)) ?? 0}
                    peakActivity={peaks.get(cellKey(weekday, hour))}
                    max={max}
                />
            ))}
        </>
    );
}

function HeatCell({ label, hour, activity, peakActivity, max }: {
    label: string; hour: number; activity: number; peakActivity: number | undefined; max: number;
}) {
    const intensity = Math.min(1, activity / max);
    const alpha = activity === 0 ? 0.05 : 0.2 + intensity * 0.7;
    const style = { background: `rgba(34,197,94,${alpha})` };
    return <button type="button" style={style} {...cellA11y(label, hour, activity, peakActivity)} />;
}

/**
 * Per-cell name + peak attributes. A peak cell adds `PEAK_MARK`, a
 * "Sat 9pm · 17 sessions" `title` and `data-peak`; other cells keep the
 * original "Sat, 14:00 — 3 sessions" label.
 */
function cellA11y(label: string, hour: number, activity: number, peakActivity: number | undefined): {
    'aria-label': string; title?: string; 'data-peak'?: 'true'; className: string;
} {
    if (peakActivity === undefined) {
        return { 'aria-label': `${label}, ${hour}:00 — ${activity} sessions`, className: CELL_BASE };
    }
    const peakLabel = peakCellLabel(label, hour, peakActivity);
    return {
        'aria-label': `${peakLabel} · peak hour`,
        title: peakLabel,
        'data-peak': 'true',
        className: `${CELL_BASE} ${PEAK_MARK}`,
    };
}

function Empty() {
    return (
        <div className="h-40 flex items-center justify-center text-sm text-muted">
            Not enough temporal data yet.
        </div>
    );
}
