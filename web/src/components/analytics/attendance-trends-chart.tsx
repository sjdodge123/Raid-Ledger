import { useState } from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';
import { useAttendanceTrends } from '../../hooks/use-analytics';
import type { AttendanceTrendsPeriod } from '@raid-ledger/contract';

export function AttendanceTrendsChart() {
    const [period, setPeriod] = useState<AttendanceTrendsPeriod>('30d');
    const { data, isLoading, error } = useAttendanceTrends(period);

    if (error) {
        return (
            <div className="bg-surface rounded-lg border border-edge p-6">
                <p className="text-red-400">Failed to load attendance trends.</p>
            </div>
        );
    }

    return (
        <div className="bg-surface rounded-lg border border-edge p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground">
                    Attendance Trends
                </h3>
                <div className="flex gap-1 bg-panel rounded-lg p-1">
                    {(['30d', '90d'] as const).map((p) => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            className={`px-3 py-1 text-sm rounded-md transition-colors ${
                                period === p
                                    ? 'bg-emerald-600 text-white'
                                    : 'text-muted hover:text-foreground'
                            }`}
                        >
                            {p === '30d' ? '30 Days' : '90 Days'}
                        </button>
                    ))}
                </div>
            </div>

            {isLoading ? (
                <div className="h-64 flex items-center justify-center">
                    <div className="animate-pulse text-muted">Loading chart data...</div>
                </div>
            ) : !data || data.dataPoints.length === 0 ? (
                <div className="h-64 flex items-center justify-center">
                    <p className="text-muted">No attendance data for this period.</p>
                </div>
            ) : (
                <>
                    {/* Summary stats */}
                    <div className="grid grid-cols-3 gap-4 mb-4">
                        <div className="text-center">
                            <p className="text-sm text-muted">Avg Attendance</p>
                            <p className="text-xl font-bold text-emerald-400">
                                {Math.round(data.summary.avgAttendanceRate * 100)}%
                            </p>
                        </div>
                        <div className="text-center">
                            <p className="text-sm text-muted">Avg No-Show</p>
                            <p className="text-xl font-bold text-red-400">
                                {Math.round(data.summary.avgNoShowRate * 100)}%
                            </p>
                        </div>
                        <div className="text-center">
                            <p className="text-sm text-muted">Total Events</p>
                            <p className="text-xl font-bold text-foreground">
                                {data.summary.totalEvents}
                            </p>
                        </div>
                    </div>

                    <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={data.dataPoints}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis
                                dataKey="date"
                                stroke="#9CA3AF"
                                fontSize={12}
                                tickFormatter={(val: string) => {
                                    const d = new Date(val + 'T00:00:00');
                                    return d.toLocaleDateString(undefined, {
                                        month: 'short',
                                        day: 'numeric',
                                    });
                                }}
                            />
                            <YAxis stroke="#9CA3AF" fontSize={12} />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#1F2937',
                                    border: '1px solid #374151',
                                    borderRadius: '8px',
                                    color: '#F3F4F6',
                                }}
                            />
                            <Legend />
                            <Line
                                type="monotone"
                                dataKey="attended"
                                stroke="#34D399"
                                strokeWidth={2}
                                dot={false}
                                name="Attended"
                            />
                            <Line
                                type="monotone"
                                dataKey="noShow"
                                stroke="#F87171"
                                strokeWidth={2}
                                dot={false}
                                name="No-Show"
                            />
                            <Line
                                type="monotone"
                                dataKey="excused"
                                stroke="#FBBF24"
                                strokeWidth={2}
                                dot={false}
                                name="Excused"
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </>
            )}
        </div>
    );
}
