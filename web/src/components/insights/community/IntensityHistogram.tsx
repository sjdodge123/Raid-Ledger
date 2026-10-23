import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { chartAxisProps, chartBarTooltipProps, chartGridProps } from '../../ui/chart-chrome';
import type { CommunityEngagementResponseDto } from '@raid-ledger/contract';

interface Props {
    buckets: CommunityEngagementResponseDto['intensityHistogram'];
}

export function IntensityHistogram({ buckets }: Props) {
    if (buckets.length === 0) {
        return <EmptyState />;
    }
    const data = buckets.map((b) => ({
        label: `${Math.round(b.bucketStart)}-${Math.round(b.bucketEnd)}`,
        userCount: b.userCount,
    }));
    return (
        <div className="h-60 w-full" data-testid="intensity-histogram">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                    <CartesianGrid {...chartGridProps} />
                    <XAxis dataKey="label" {...chartAxisProps} fontSize={11} />
                    <YAxis {...chartAxisProps} fontSize={11} allowDecimals={false} />
                    <Tooltip {...chartBarTooltipProps} />
                    <Bar dataKey="userCount" fill="#38bdf8" isAnimationActive={false} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="h-60 flex items-center justify-center text-sm text-muted">
            Not enough intensity data yet.
        </div>
    );
}
