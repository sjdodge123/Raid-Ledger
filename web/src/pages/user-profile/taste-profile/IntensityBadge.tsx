import type { JSX } from "react";
import type {
    ArchetypeDto,
    IntensityMetricsDto,
} from "@raid-ledger/contract";
import {
    composeArchetypeLabel,
    formatFocusIndicator,
    formatIntensity,
} from "../../../components/taste-profile/taste-profile-helpers";

interface IntensityBadgeProps {
    archetype: ArchetypeDto;
    metrics: IntensityMetricsDto;
}

/**
 * Multi-row summary (ROK-1083):
 *   Row 1: `{intensity}/100 · {Tier} {Title1} [& {Title2}]`
 *   Row 2: tier description (e.g. "Plays nearly daily, many hours per week")
 *   Row 3+: one line per vector-title description
 *   Row N: focus / varied indicator (hidden when neither threshold hit)
 */
export function IntensityBadge({
    archetype,
    metrics,
}: IntensityBadgeProps): JSX.Element {
    const intensityText = formatIntensity(metrics.intensity);
    const label = composeArchetypeLabel(archetype);
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
                <span className="intensity-badge__archetype">{label}</span>
            </p>
            <ArchetypeDescriptions archetype={archetype} />
            {focusLine && (
                <p className="intensity-badge__focus">{focusLine}</p>
            )}
        </div>
    );
}

/**
 * Description lines: tier blurb first, then one line per vector-title
 * blurb (same order as `vectorTitles`). Renders nothing when all copy
 * strings are empty.
 */
function ArchetypeDescriptions({
    archetype,
}: {
    archetype: ArchetypeDto;
}): JSX.Element | null {
    const { tier, titles } = archetype.descriptions;
    const lines = [tier, ...titles].filter((line) => line.trim().length > 0);
    if (lines.length === 0) return null;
    return (
        <>
            {lines.map((line, idx) => (
                <p
                    key={`${idx}-${line}`}
                    className="intensity-badge__description"
                >
                    {line}
                </p>
            ))}
        </>
    );
}
