import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { EventAttendanceSummaryDto } from '@raid-ledger/contract';

interface EventAttendanceDonutProps {
    summary: EventAttendanceSummaryDto;
}

const COLORS = {
    attended: '#34D399',
    noShow: '#F87171',
    excused: '#FBBF24',
    unmarked: '#6B7280',
};

export function EventAttendanceDonut({ summary }: EventAttendanceDonutProps) {
    const chartData = [
        { name: 'Attended', value: summary.attended, color: COLORS.attended },
        { name: 'No-Show', value: summary.noShow, color: COLORS.noShow },
        { name: 'Excused', value: summary.excused, color: COLORS.excused },
        { name: 'Unmarked', value: summary.unmarked, color: COLORS.unmarked },
    ].filter((d) => d.value > 0);

    const ratePercent = Math.round(summary.attendanceRate * 100);

    return (
        <div className="bg-surface rounded-lg border border-edge p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">
                Attendance Summary
            </h3>

            <div className="flex flex-col sm:flex-row items-center gap-6">
                {/* Donut Chart */}
                <div className="relative w-48 h-48">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={chartData}
                                cx="50%"
                                cy="50%"
                                innerRadius={50}
                                outerRadius={80}
                                paddingAngle={2}
                                dataKey="value"
                            >
                                {chartData.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={entry.color}
                                    />
                                ))}
                            </Pie>
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#1F2937',
                                    border: '1px solid #374151',
                                    borderRadius: '8px',
                                    color: '#F3F4F6',
                                }}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                    {/* Center label */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-2xl font-bold text-foreground">
                            {ratePercent}%
                        </span>
                        <span className="text-xs text-muted">attended</span>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                    <StatPill
                        label="Attended"
                        value={summary.attended}
                        color="bg-emerald-400"
                    />
                    <StatPill
                        label="No-Show"
                        value={summary.noShow}
                        color="bg-red-400"
                    />
                    <StatPill
                        label="Excused"
                        value={summary.excused}
                        color="bg-amber-400"
                    />
                    <StatPill
                        label="Unmarked"
                        value={summary.unmarked}
                        color="bg-gray-500"
                    />
                    <div className="col-span-2 pt-2 border-t border-edge">
                        <span className="text-muted">
                            Total: {summary.total} signups
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatPill({
    label,
    value,
    color,
}: {
    label: string;
    value: number;
    color: string;
}) {
    return (
        <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${color}`} />
            <span className="text-muted">{label}:</span>
            <span className="text-foreground font-semibold">{value}</span>
        </div>
    );
}
