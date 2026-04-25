import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { CommunityRadarResponseDto, TasteProfilePoolAxis } from '@raid-ledger/contract';
import { axisLabel } from '../../taste-profile/taste-profile-helpers';

interface Props {
    driftSeries: CommunityRadarResponseDto['driftSeries'];
}

const COLORS = ['#a855f7', '#22c55e', '#fbbf24'];

/**
 * 8-week taste drift for the top-3 axes by current-week mean score.
 * Empty state renders when the backend has not yet accumulated drift
 * history.
 */
export function TasteDriftChart({ driftSeries }: Props) {
    if (driftSeries.length === 0) {
        return (
            <div className="h-60 flex items-center justify-center text-sm text-muted">
                Not enough history yet to plot taste drift.
            </div>
        );
    }
    const { weeks, topAxes, rows } = reshape(driftSeries);
    return (
        <div className="h-60 w-full" data-testid="taste-drift-chart">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                    <XAxis dataKey="weekStart" stroke="#a1a1aa" fontSize={11} />
                    <YAxis stroke="#a1a1aa" fontSize={11} domain={[0, 100]} />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {topAxes.map((axis, i) => (
                        <Line key={axis} type="monotone" dataKey={axis}
                            stroke={COLORS[i] ?? '#a855f7'} strokeWidth={2} dot={false}
                            isAnimationActive={false}
                            name={axisLabel(axis as TasteProfilePoolAxis)} />
                    ))}
                    {/* weeks consumed as X-axis categories */}
                    {weeks.length === 0 && null}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

function reshape(driftSeries: CommunityRadarResponseDto['driftSeries']) {
    const weeks = Array.from(new Set(driftSeries.map((p) => p.weekStart))).sort();
    const latest = weeks[weeks.length - 1];
    const topAxes = driftSeries
        .filter((p) => p.weekStart === latest)
        .sort((a, b) => b.meanScore - a.meanScore)
        .slice(0, 3)
        .map((p) => p.axis);
    const rows = weeks.map((weekStart) => {
        const row: Record<string, string | number> = { weekStart };
        for (const axis of topAxes) {
            const p = driftSeries.find((x) => x.weekStart === weekStart && x.axis === axis);
            row[axis] = Math.round(p?.meanScore ?? 0);
        }
        return row;
    });
    return { weeks, topAxes, rows };
}
