import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { chartAxisProps, chartLineTooltipProps, chartGridProps } from '../../ui/chart-chrome';
import type { CommunityRadarResponseDto, TasteProfilePoolAxis } from '@raid-ledger/contract';
import { axisLabel } from '../../taste-profile/taste-profile-helpers';
import { reshape } from './taste-drift-helpers';

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
                    <CartesianGrid {...chartGridProps} />
                    <XAxis dataKey="weekStart" {...chartAxisProps} fontSize={11} />
                    <YAxis {...chartAxisProps} fontSize={11} domain={[0, 100]} />
                    <Tooltip {...chartLineTooltipProps} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {topAxes.map((axis, i) => (
                        <Line key={axis} type="monotone" dataKey={axis}
                            stroke={COLORS[i] ?? '#a855f7'} strokeWidth={2}
                            dot={weeks.length === 1}
                            isAnimationActive={false}
                            name={axisLabel(axis as TasteProfilePoolAxis)} />
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

