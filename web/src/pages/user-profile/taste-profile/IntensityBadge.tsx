import type { JSX } from "react";
import type {
    IntensityMetricsDto,
    TasteProfileArchetype,
} from "@raid-ledger/contract";
import {
    formatFocusIndicator,
    formatIntensity,
} from "../../../components/taste-profile/taste-profile-helpers";

interface IntensityBadgeProps {
    archetype: TasteProfileArchetype;
    metrics: IntensityMetricsDto;
}

/**
 * Two-row summary:
 *   Row 1: `{intensity}/100 · {archetype}`
 *   Row 2: focus / varied indicator (hidden when neither threshold hit)
 */
export function IntensityBadge({
    archetype,
    metrics,
}: IntensityBadgeProps): JSX.Element {
    const intensityText = formatIntensity(metrics.intensity);
    const focusLine = formatFocusIndicator(metrics.focus, metrics.breadth);
    return (
        <div className="intensity-badge" data-testid="intensity-badge">
            <p className="intensity-badge__primary">
                <span className="intensity-badge__intensity">
                    {intensityText}
                </span>
                <span className="intensity-badge__sep" aria-hidden="true">
                    {" · "}
                </span>
                <span className="intensity-badge__archetype">{archetype}</span>
            </p>
            {focusLine && (
                <p className="intensity-badge__focus">{focusLine}</p>
            )}
        </div>
    );
}
