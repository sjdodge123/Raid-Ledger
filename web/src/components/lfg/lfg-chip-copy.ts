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
 * The server's `state`, or the count's own verdict when it is absent — a group
 * of 2+ is `lfm` ("join them"), anything less is `lfg` ("they need you").
 *
 * @param activeCount - Live intents on the game.
 * @param state - Server-derived state, when the payload carries one.
 */
export function effectiveLfgState(
    activeCount: number,
    state?: 'lfg' | 'lfm' | null,
): 'lfg' | 'lfm' {
    return state ?? (activeCount >= 2 ? 'lfm' : 'lfg');
}

/**
 * The group's state in words, WITHOUT the 🎯 — `N looking to play` once a group
 * has formed, or `N looking · needs M more` while it still needs people.
 *
 * Emoji-free so a caller that already leads with 🎯 (the events banner, which
 * reads `🎯 {gameName} · {groupLine}`) does not print two of them.
 *
 * @param activeCount - Live intents on the game.
 * @param state - `lfm` (2+) or `lfg` (still recruiting).
 * @param viabilityThreshold - `games.cooptimusOnlineMax`, when it is known.
 */
export function groupLine(
    activeCount: number,
    state: 'lfg' | 'lfm',
    viabilityThreshold?: number | null,
): string {
    if (state === 'lfm') return `${activeCount} looking to play`;
    const needed = playersStillNeeded(activeCount, viabilityThreshold);
    return `${activeCount} looking · needs ${needed} more`;
}

/**
 * The urgency headline: how many people want to play RIGHT NOW (ROK-1479 A6).
 *
 * Counts PLAYERS, and deliberately says nothing about the weekly cohort — the
 * combined form (`🔥 2 now · 🎯 3 this week`) is longer than the tile overlay
 * holds, so the breakdown lives on the group page instead.
 *
 * @param nowCount - Live `now` intents on the game. Always 1 or more here.
 */
export function nowLine(nowCount: number): string {
    return `🔥 ${nowCount} want to play now`;
}

/**
 * The card badge's sentence — `groupLine` behind the 🎯 the chip has always
 * carried, or ROK-1479's now line when anybody is looking for right now.
 *
 * The now branch is FIRST and it replaces rather than augments (A6). With no
 * `now` intents the two 🎯 strings are byte-identical to what ROK-1453
 * shipped, which is what keeps every existing chip assertion true.
 *
 * @param activeCount - Live intents on the game, BOTH urgencies.
 * @param state - `lfm` (2+) or `lfg` (still recruiting).
 * @param viabilityThreshold - `games.cooptimusOnlineMax`, when it is known.
 * @param nowCount - How many of `activeCount` are `now` intents.
 */
export function chipLabel(
    activeCount: number,
    state: 'lfg' | 'lfm',
    viabilityThreshold?: number | null,
    nowCount?: number | null,
): string {
    if (nowCount != null && nowCount > 0) return nowLine(nowCount);
    return `🎯 ${groupLine(activeCount, state, viabilityThreshold)}`;
}
