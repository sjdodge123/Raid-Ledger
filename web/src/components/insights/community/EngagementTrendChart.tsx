import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { chartAxisProps, chartLineTooltipProps, chartGridProps } from '../../ui/chart-chrome';
import type { CommunityEngagementResponseDto } from '@raid-ledger/contract';

interface Props {
    weeklyActiveUsers: CommunityEngagementResponseDto['weeklyActiveUsers'];
}

export function EngagementTrendChart({ weeklyActiveUsers }: Props) {
    if (weeklyActiveUsers.length === 0) {
        return <EmptyState />;
    }
    const data = weeklyActiveUsers.map((p) => ({
        weekStart: p.weekStart, activeUsers: p.activeUsers,
    }));
    return (
        <div className="h-60 w-full" data-testid="engagement-trend">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                    <CartesianGrid {...chartGridProps} />
                    <XAxis dataKey="weekStart" {...chartAxisProps} fontSize={11} />
                    <YAxis {...chartAxisProps} fontSize={11} allowDecimals={false} />
                    <Tooltip {...chartLineTooltipProps} />
                    <Line type="monotone" dataKey="activeUsers" stroke="#22c55e" strokeWidth={2}
                        dot={false} isAnimationActive={false} name="Active users" />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="h-60 flex items-center justify-center text-sm text-muted">
            Not enough activity history yet.
        </div>
    );
}
