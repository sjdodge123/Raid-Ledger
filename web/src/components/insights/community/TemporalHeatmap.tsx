import type { CommunityTemporalResponseDto } from '@raid-ledger/contract';

interface Props {
    heatmap: CommunityTemporalResponseDto['heatmap'];
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * 7 × 24 activity heatmap. Cell shade is a percentile over the max
 * activity cell in the snapshot; each cell is keyboard-focusable with an
 * `aria-label` spelling out the weekday / hour / activity count.
 */
export function TemporalHeatmap({ heatmap }: Props) {
    if (heatmap.length === 0) {
        return <Empty />;
    }
    const max = Math.max(1, ...heatmap.map((c) => c.activity));
    const byCell = new Map(heatmap.map((c) => [`${c.weekday}:${c.hour}`, c.activity]));

    return (
        <div className="overflow-x-auto" data-testid="temporal-heatmap">
            <div className="grid" style={{ gridTemplateColumns: '3rem repeat(24, minmax(1.25rem, 1fr))' }}>
                <div className="text-xs text-muted" />
                {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="text-[10px] text-muted text-center">{h}</div>
                ))}
                {WEEKDAY_LABELS.map((label, idx) => {
                    const weekday = idx + 1;
                    return (
                        <WeekdayRow key={weekday} label={label} weekday={weekday} max={max} byCell={byCell} />
                    );
                })}
            </div>
        </div>
    );
}

function WeekdayRow({ label, weekday, max, byCell }: {
    label: string; weekday: number; max: number; byCell: Map<string, number>;
}) {
    return (
        <>
            <div className="text-xs text-muted flex items-center pr-2">{label}</div>
            {Array.from({ length: 24 }, (_, hour) => {
                const activity = byCell.get(`${weekday}:${hour}`) ?? 0;
                const intensity = Math.min(1, activity / max);
                const alpha = activity === 0 ? 0.05 : 0.2 + intensity * 0.7;
                return (
                    <button
                        type="button"
                        key={hour}
                        aria-label={`${label}, ${hour}:00 — ${activity} sessions`}
                        className="h-5 rounded-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        style={{ background: `rgba(34,197,94,${alpha})` }}
                    />
                );
            })}
        </>
    );
}

function Empty() {
    return (
        <div className="h-40 flex items-center justify-center text-sm text-muted">
            Not enough temporal data yet.
        </div>
    );
}
