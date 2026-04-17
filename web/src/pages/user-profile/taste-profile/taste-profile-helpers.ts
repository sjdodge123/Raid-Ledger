/**
 * Pure helpers for the taste-profile UI (ROK-949).
 *
 * All functions are side-effect free so they can be unit-tested without
 * any rendering or network calls.
 */
import {
    TASTE_PROFILE_AXES,
    type TasteProfileAxis,
    type TasteProfileResponseDto,
} from "@raid-ledger/contract";

/**
 * Returns true when every dimension value is 0 — the signal that the
 * user has not accumulated any play history yet.
 */
export function isEmptyTasteProfile(
    profile: TasteProfileResponseDto,
): boolean {
    return TASTE_PROFILE_AXES.every((axis) => profile.dimensions[axis] === 0);
}

/**
 * Human-readable axis labels (text only — no emoji/SVG). Used both for
 * chart labels and for the radar chart's `aria-label`.
 */
export function axisLabel(axis: TasteProfileAxis): string {
    switch (axis) {
        case "co_op":
            return "Co-op";
        case "pvp":
            return "PvP";
        case "rpg":
            return "RPG";
        case "survival":
            return "Survival";
        case "strategy":
            return "Strategy";
        case "social":
            return "Social";
        case "mmo":
            return "MMO";
    }
}

/**
 * Returns the "focused play" / "varied play" indicator line, or `null`
 * when neither threshold applies. Both focus and breadth are scaled
 * 0–100 server-side; we render the indicator when one clearly
 * dominates (> 60).
 */
export function formatFocusIndicator(
    focus: number,
    breadth: number,
): string | null {
    if (focus > 60) return `Focused play (${focus}%)`;
    if (breadth > 60) return `Varied play (${breadth}%)`;
    return null;
}

/**
 * Formats the primary intensity text.  `intensity` is a 0–100 percentile
 * rank (see `api/src/taste-profile/intensity-rollup.helpers.ts`) so we
 * render it as `Intensity: {n}/100` rather than inventing hours.
 */
export function formatIntensity(intensity: number): string {
    return `Intensity: ${intensity}/100`;
}
