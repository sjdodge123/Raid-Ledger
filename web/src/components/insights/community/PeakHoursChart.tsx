import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { CommunityTemporalResponseDto } from '@raid-ledger/contract';

interface Props {
    peakHours: CommunityTemporalResponseDto['peakHours'];
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Peak hours per weekday as a stacked bar chart. Each weekday shows its
 * top-3 hours stacked so operators can compare volume across days at a
 * glance.
 */
export function PeakHoursChart({ peakHours }: Props) {
    if (peakHours.length === 0) {
        return <Empty />;
    }
    const rows = buildRows(peakHours);
    const stackKeys: Array<'h1' | 'h2' | 'h3'> = ['h1', 'h2', 'h3'];
    return (
        <div className="h-60 w-full" data-testid="peak-hours-chart">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                    <XAxis dataKey="day" stroke="#a1a1aa" fontSize={11} />
                    <YAxis stroke="#a1a1aa" fontSize={11} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {stackKeys.map((k, i) => (
                        <Bar key={k} dataKey={k} stackId="peak"
                            fill={['#22c55e', '#38bdf8', '#a855f7'][i]}
                            isAnimationActive={false}
                            name={`Hour #${i + 1}`} />
                    ))}
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

function buildRows(peakHours: CommunityTemporalResponseDto['peakHours']) {
    const byDay = new Map<number, { hour: number; activity: number }[]>();
    for (const p of peakHours) {
        const list = byDay.get(p.weekday) ?? [];
        list.push({ hour: p.hour, activity: p.activity });
        byDay.set(p.weekday, list);
    }
    const rows: Array<Record<string, string | number>> = [];
    for (let wd = 1; wd <= 7; wd += 1) {
        const top = (byDay.get(wd) ?? [])
            .sort((a, b) => b.activity - a.activity)
            .slice(0, 3);
        rows.push({
            day: WEEKDAY_LABELS[wd - 1],
            h1: top[0]?.activity ?? 0,
            h2: top[1]?.activity ?? 0,
            h3: top[2]?.activity ?? 0,
        });
    }
    return rows;
}

function Empty() {
    return (
        <div className="h-60 flex items-center justify-center text-sm text-muted">
            Not enough peak-hour data yet.
        </div>
    );
}
