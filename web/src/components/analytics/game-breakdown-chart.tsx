import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';
import { useGameAttendance } from '../../hooks/use-analytics';

export function GameBreakdownChart() {
    const { data, isLoading, error } = useGameAttendance();

    if (error) {
        return (
            <div className="bg-surface rounded-lg border border-edge p-6">
                <p className="text-red-400">Failed to load game attendance data.</p>
            </div>
        );
    }

    return (
        <div className="bg-surface rounded-lg border border-edge p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">
                Per-Game Breakdown
            </h3>

            {isLoading ? (
                <div className="h-64 flex items-center justify-center">
                    <div className="animate-pulse text-muted">Loading chart data...</div>
                </div>
            ) : !data || data.games.length === 0 ? (
                <div className="h-64 flex items-center justify-center">
                    <p className="text-muted">No per-game attendance data yet.</p>
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={280}>
                    <BarChart
                        data={data.games.map((g) => ({
                            name: g.gameName.length > 18
                                ? g.gameName.slice(0, 16) + '...'
                                : g.gameName,
                            fullName: g.gameName,
                            attendance: Math.round(g.avgAttendanceRate * 100),
                            noShow: Math.round(g.avgNoShowRate * 100),
                            events: g.totalEvents,
                        }))}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                            dataKey="name"
                            stroke="#9CA3AF"
                            fontSize={12}
                        />
                        <YAxis
                            stroke="#9CA3AF"
                            fontSize={12}
                            tickFormatter={(val: number) => `${val}%`}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: '#1F2937',
                                border: '1px solid #374151',
                                borderRadius: '8px',
                                color: '#F3F4F6',
                            }}
                            formatter={((value: number | undefined, name: string | undefined) => [
                                `${value ?? 0}%`,
                                name ?? '',
                            ]) as never}
                        />
                        <Legend />
                        <Bar
                            dataKey="attendance"
                            fill="#34D399"
                            name="Attendance %"
                            radius={[4, 4, 0, 0]}
                        />
                        <Bar
                            dataKey="noShow"
                            fill="#F87171"
                            name="No-Show %"
                            radius={[4, 4, 0, 0]}
                        />
                    </BarChart>
                </ResponsiveContainer>
            )}
        </div>
    );
}
