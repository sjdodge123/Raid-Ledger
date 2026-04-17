/**
 * Pure helpers for the taste-profile UI (ROK-949).
 *
 * All functions are side-effect free so they can be unit-tested without
 * any rendering or network calls.
 */
import {
    TASTE_PROFILE_AXIS_POOL,
    type TasteProfilePoolAxis,
    type TasteProfileResponseDto,
} from "@raid-ledger/contract";

/**
 * Returns true when every dimension value in the pool is 0 — the signal
 * that the user has not accumulated any play history yet.
 */
export function isEmptyTasteProfile(
    profile: TasteProfileResponseDto,
): boolean {
    const dims = profile.dimensions as Record<string, number>;
    return TASTE_PROFILE_AXIS_POOL.every((axis) => (dims[axis] ?? 0) === 0);
}

/** Sorted `{ axis, value }` tuples — highest values first. */
export interface AxisScore {
    axis: TasteProfilePoolAxis;
    value: number;
}

/**
 * Returns the top `n` axes for a player, sorted by score descending.
 * Ties are broken by `TASTE_PROFILE_AXIS_POOL` order for determinism.
 * Output length is always `min(n, pool size)`.
 */
export function topAxes(
    dimensions: TasteProfileResponseDto["dimensions"],
    n = 7,
): AxisScore[] {
    const dims = dimensions as Record<string, number>;
    const scored: AxisScore[] = TASTE_PROFILE_AXIS_POOL.map((axis) => ({
        axis,
        value: dims[axis] ?? 0,
    }));
    scored.sort((a, b) => b.value - a.value);
    return scored.slice(0, n);
}

/**
 * Human-readable axis labels covering the full 20-axis pool. Used for
 * chart labels and for the radar chart's `aria-label`.
 */
export function axisLabel(axis: TasteProfilePoolAxis): string {
    switch (axis) {
        case "co_op":
            return "Co-op";
        case "pvp":
            return "PvP";
        case "battle_royale":
            return "Battle Royale";
        case "mmo":
            return "MMO";
        case "moba":
            return "MOBA";
        case "fighting":
            return "Fighting";
        case "shooter":
            return "Shooter";
        case "racing":
            return "Racing";
        case "sports":
            return "Sports";
        case "rpg":
            return "RPG";
        case "fantasy":
            return "Fantasy";
        case "sci_fi":
            return "Sci-Fi";
        case "adventure":
            return "Adventure";
        case "strategy":
            return "Strategy";
        case "rts":
            return "RTS";
        case "tbs":
            return "TBS";
        case "survival":
            return "Survival";
        case "sandbox":
            return "Sandbox";
        case "horror":
            return "Horror";
        case "social":
            return "Social";
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
 * Formats the primary intensity text. `intensity` is a 0–100 percentile
 * rank (see `api/src/taste-profile/intensity-rollup.helpers.ts`) so we
 * render it as `Intensity: {n}/100` rather than inventing hours.
 */
export function formatIntensity(intensity: number): string {
    return `Intensity: ${intensity}/100`;
}
