import type { JSX } from "react";
import {
    Radar,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    ResponsiveContainer,
} from "recharts";
import { TASTE_PROFILE_AXES } from "@raid-ledger/contract";
import type { TasteProfileDimensionsDto } from "@raid-ledger/contract";

interface GameRadarChartProps {
    dimensions: TasteProfileDimensionsDto;
}

/**
 * ROK-1082: Minimal 7-axis radar chart for games. Parallel to the
 * player `TasteRadarChart`, but intentionally separate — games have
 * no archetype, so sharing the component would add a dead branch.
 */
export function GameRadarChart({ dimensions }: GameRadarChartProps): JSX.Element {
    const dims = dimensions as unknown as Record<string, number>;
    const data = TASTE_PROFILE_AXES.map((axis) => ({
        axis,
        value: dims[axis] ?? 0,
    }));
    return (
        <div
            className="game-taste-radar"
            data-testid="game-radar-chart"
            role="img"
            aria-label="Game taste radar"
        >
            <ResponsiveContainer width="100%" height={320}>
                <RadarChart data={data} outerRadius="75%">
                    <PolarGrid stroke="rgba(255,255,255,0.15)" />
                    <PolarAngleAxis
                        dataKey="axis"
                        tick={{ fill: "#a1a1aa", fontSize: 12 }}
                    />
                    <PolarRadiusAxis
                        domain={[0, 100]}
                        tick={false}
                        axisLine={false}
                    />
                    <Radar
                        dataKey="value"
                        stroke="#a855f7"
                        strokeWidth={2}
                        fill="#a855f7"
                        fillOpacity={0.4}
                        isAnimationActive={false}
                    />
                </RadarChart>
            </ResponsiveContainer>
        </div>
    );
}
