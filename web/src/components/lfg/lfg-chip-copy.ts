/**
 * The one sentence an LFG group is described with (ROK-1478 D4).
 *
 * Extracted VERBATIM from `lfg-chip.tsx` so the events banner and the card
 * badge cannot drift apart about the same group. Deliberately NOT
 * `pages/lfg/lfg-copy.ts::lookingLine`, which has no `max(1, …)` clamp and
 * falls back to different prose when the threshold is null — reusing it would
 * silently change the group page (ROK-1478 AC7 forbids that).
 */

/** Assumed group size when a game has no Co-Optimus data: two players. */
export const DEFAULT_VIABILITY_THRESHOLD = 2;

/**
 * How many more players the group still needs — never fewer than one, so a
 * single-player group never reads "needs 0 more".
 *
 * @param activeCount - Live intents on the game.
 * @param viabilityThreshold - `games.cooptimusOnlineMax`, when it is known.
 */
export function playersStillNeeded(
    activeCount: number,
    viabilityThreshold?: number | null,
): number {
    const target = viabilityThreshold ?? DEFAULT_VIABILITY_THRESHOLD;
    return Math.max(1, target - activeCount);
}

/**
 * The chip's sentence: `🎯 N looking to play` once a group has formed, or
 * `🎯 N looking · needs M more` while it still needs people.
 *
 * @param activeCount - Live intents on the game.
 * @param state - `lfm` (2+) or `lfg` (still recruiting).
 * @param viabilityThreshold - `games.cooptimusOnlineMax`, when it is known.
 */
export function chipLabel(
    activeCount: number,
    state: 'lfg' | 'lfm',
    viabilityThreshold?: number | null,
): string {
    if (state === 'lfm') return `🎯 ${activeCount} looking to play`;
    const needed = playersStillNeeded(activeCount, viabilityThreshold);
    return `🎯 ${activeCount} looking · needs ${needed} more`;
}
