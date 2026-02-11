import type { DashboardStatsDto } from '@raid-ledger/contract';

interface DashboardStatsRowProps {
    stats: DashboardStatsDto;
}

function StatCard({
    label,
    value,
    accent,
}: {
    label: string;
    value: string | number;
    accent?: boolean;
}) {
    return (
        <div className="bg-surface rounded-lg border border-edge p-4">
            <p className="text-sm text-muted mb-1">{label}</p>
            <p
                className={`text-2xl font-bold ${accent ? 'text-amber-400' : 'text-foreground'}`}
            >
                {value}
            </p>
        </div>
    );
}

export function DashboardStatsRow({ stats }: DashboardStatsRowProps) {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Upcoming" value={stats.totalUpcomingEvents} />
            <StatCard label="Signups" value={stats.totalSignups} />
            <StatCard
                label="Avg Fill"
                value={stats.averageFillRate > 0 ? `${stats.averageFillRate}%` : '—'}
            />
            <StatCard
                label="Needs Attention"
                value={stats.eventsWithRosterGaps}
                accent={stats.eventsWithRosterGaps > 0}
            />
        </div>
    );
}

export function DashboardStatsRowSkeleton() {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
                <div
                    key={i}
                    className="bg-surface rounded-lg border border-edge p-4 animate-pulse"
                >
                    <div className="h-4 bg-panel rounded w-20 mb-2" />
                    <div className="h-8 bg-panel rounded w-12" />
                </div>
            ))}
        </div>
    );
}
