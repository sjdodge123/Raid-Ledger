import type { JSX } from "react";
import {
    TASTE_PROFILE_AXIS_POOL,
    type TasteProfileDimensionsDto,
    type TasteProfilePoolAxis,
} from "@raid-ledger/contract";
import { axisLabel } from "../../user-profile/taste-profile/taste-profile-helpers";

interface AxisBreakdownProps {
    dimensions: TasteProfileDimensionsDto;
    /** Number of top axes to show (default 5). */
    limit?: number;
}

interface ScoredAxis {
    axis: TasteProfilePoolAxis;
    value: number;
}

function rankTopAxes(
    dimensions: TasteProfileDimensionsDto,
    limit: number,
): ScoredAxis[] {
    const dims = dimensions as unknown as Record<string, number>;
    const scored: ScoredAxis[] = TASTE_PROFILE_AXIS_POOL.map((axis) => ({
        axis,
        value: dims[axis] ?? 0,
    }));
    scored.sort((a, b) => b.value - a.value);
    return scored.filter((s) => s.value > 0).slice(0, limit);
}

/**
 * ROK-1082: Top-N axis breakdown for a game taste profile. Renders
 * the axes with the highest normalized scores as a labeled bar list.
 */
export function AxisBreakdown({
    dimensions,
    limit = 5,
}: AxisBreakdownProps): JSX.Element {
    const rows = rankTopAxes(dimensions, limit);
    return (
        <ul
            className="space-y-2"
            data-testid="axis-breakdown"
        >
            {rows.map((row) => (
                <AxisRow key={row.axis} axis={row.axis} value={row.value} />
            ))}
        </ul>
    );
}

function AxisRow({
    axis,
    value,
}: {
    axis: TasteProfilePoolAxis;
    value: number;
}): JSX.Element {
    const pct = Math.max(0, Math.min(100, Math.round(value)));
    return (
        <li className="flex items-center gap-3 text-sm">
            <span className="w-24 text-secondary">{axisLabel(axis)}</span>
            <span className="flex-1 h-2 bg-overlay rounded-full overflow-hidden">
                <span
                    className="block h-full bg-emerald-500"
                    style={{ width: `${pct}%` }}
                />
            </span>
            <span className="w-10 text-right text-muted tabular-nums">
                {pct}
            </span>
        </li>
    );
}
