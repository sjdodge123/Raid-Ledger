import type { JSX } from "react";
import {
    Radar,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    ResponsiveContainer,
} from "recharts";
import type {
    IntensityMetricsDto,
    TasteProfileArchetype,
    TasteProfileDimensionsDto,
} from "@raid-ledger/contract";
import { ArchetypePill } from "./ArchetypePill";
import { axisLabel, topAxes, type AxisScore } from "./taste-profile-helpers";

interface TasteRadarChartProps {
    archetype: TasteProfileArchetype;
    dimensions: TasteProfileDimensionsDto;
    intensityMetrics?: IntensityMetricsDto;
}

/**
 * Screen-reader summary of the radar (AC7). Includes the archetype,
 * every rendered axis with its score, and — when available — the
 * top-level intensity/focus/breadth numbers so non-sighted users get
 * the same at-a-glance picture the chart provides visually.
 */
function buildAriaLabel(
    archetype: TasteProfileArchetype,
    scores: AxisScore[],
    metrics?: IntensityMetricsDto,
): string {
    const axes = scores
        .map((s) => `${axisLabel(s.axis)} ${s.value}`)
        .join(", ");
    const header = `Taste profile for ${archetype}`;
    if (!metrics) return `${header}: ${axes}.`;
    return (
        `${header}. Intensity ${metrics.intensity} of 100, ` +
        `focus ${metrics.focus}, breadth ${metrics.breadth}, ` +
        `consistency ${metrics.consistency}. Axes: ${axes}.`
    );
}

function RadarGradientDefs(): JSX.Element {
    return (
        <defs>
            <radialGradient id="taste-radial" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.55} />
                <stop offset="55%" stopColor="#fbbf24" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0.55} />
            </radialGradient>
        </defs>
    );
}

function RadarBody({
    data,
}: {
    data: { axis: string; value: number }[];
}): JSX.Element {
    return (
        <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} outerRadius="75%">
                <RadarGradientDefs />
                <PolarGrid stroke="rgba(255,255,255,0.15)" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar
                    dataKey="value"
                    stroke="#a855f7"
                    strokeWidth={2}
                    fill="url(#taste-radial)"
                    fillOpacity={0.85}
                    isAnimationActive={false}
                />
            </RadarChart>
        </ResponsiveContainer>
    );
}

/**
 * 7-axis radar chart with radial red→yellow→green fill and an archetype
 * hero title above. Chart height is driven by CSS (300px desktop, 240px
 * mobile) via `.taste-radar__chart-wrap`.
 *
 * Each player sees their personal top 7 axes selected from the full pool,
 * so the radar reflects what they actually play (ROK-949 dynamic axes).
 */
export function TasteRadarChart({
    archetype,
    dimensions,
    intensityMetrics,
}: TasteRadarChartProps): JSX.Element {
    const scores = topAxes(dimensions, 7);
    const data = scores.map((s) => ({
        axis: axisLabel(s.axis),
        value: s.value,
    }));
    const ariaLabel = buildAriaLabel(archetype, scores, intensityMetrics);
    return (
        <div className="taste-radar">
            <div className="taste-radar__title">
                <span className="taste-radar__title-prefix">
                    Taste Radar —{" "}
                </span>
                <ArchetypePill archetype={archetype} size="lg" />
            </div>
            <div
                className="taste-radar__chart-wrap"
                role="img"
                aria-label={ariaLabel}
            >
                <RadarBody data={data} />
            </div>
        </div>
    );
}
