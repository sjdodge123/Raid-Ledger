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
import { chartAxisProps, chartBarTooltipProps, chartGridProps } from '../ui/chart-chrome';
import type { GameAttendanceDto } from '@raid-ledger/contract';
import { useGameAttendance } from '../../hooks/use-analytics';

/** ROK-1938 copy C2. */
const LATE_RATE_FOOTNOTE = 'Late % is part of Attendance %. Events without a voice channel never show as late.';

type GameRowInput = Pick<GameAttendanceDto, 'gameName' | 'avgAttendanceRate' | 'avgNoShowRate' | 'avgLateRate' | 'totalEvents'>;

function formatGameData(games: GameRowInput[]) {
    return games.map((g) => ({
        name: g.gameName.length > 18 ? g.gameName.slice(0, 16) + '...' : g.gameName,
        fullName: g.gameName,
        attendance: Math.round(g.avgAttendanceRate * 100),
        late: Math.round((g.avgLateRate ?? 0) * 100),
        noShow: Math.round(g.avgNoShowRate * 100),
        events: g.totalEvents,
    }));
}

function GameBarChart({ data }: { data: ReturnType<typeof formatGameData> }) {
    return (
        <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="name" {...chartAxisProps} fontSize={12} />
                <YAxis {...chartAxisProps} fontSize={12} tickFormatter={(val: number) => `${val}%`} />
                <Tooltip {...chartBarTooltipProps} formatter={((value: number | undefined, name: string | undefined) => [`${value ?? 0}%`, name ?? '']) as never} />
                <Legend />
                {/* Outcome series → semantic tokens, never a hex (design-system.md §2.2, ROK-1938). */}
                <Bar dataKey="attendance" fill="var(--color-success)" name="Attendance %" radius={[4, 4, 0, 0]} />
                <Bar dataKey="late" fill="var(--color-warning)" name="Late %" radius={[4, 4, 0, 0]} />
                <Bar dataKey="noShow" fill="var(--color-danger)" name="No-Show %" radius={[4, 4, 0, 0]} />
            </BarChart>
        </ResponsiveContainer>
    );
}

export function GameBreakdownChart() {
    const { data, isLoading, error } = useGameAttendance();

    if (error) {
        return <div className="bg-surface rounded-lg border border-edge p-6"><p className="text-danger">Failed to load game attendance data.</p></div>;
    }

    return (
        <div className="bg-surface rounded-lg border border-edge p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Per-Game Breakdown</h3>
            {isLoading ? (
                <div className="h-64 flex items-center justify-center"><div className="animate-pulse text-muted">Loading chart data...</div></div>
            ) : !data || data.games.length === 0 ? (
                <div className="h-64 flex items-center justify-center"><p className="text-muted">No per-game attendance data yet.</p></div>
            ) : (
                <>
                    <GameBarChart data={formatGameData(data.games)} />
                    <p className="text-xs text-muted mt-3">{LATE_RATE_FOOTNOTE}</p>
                </>
            )}
        </div>
    );
}
