/**
 * The one sentence an LFG group is described with (ROK-1478 D4).
 *
 * Extracted VERBATIM from `lfg-chip.tsx` so the events banner and the card
 * badge cannot drift apart about the same group (the sentence itself now lives
 * in the contract — see below). Deliberately NOT
 * `pages/lfg/lfg-copy.ts::lookingLine`, which has no `max(1, …)` clamp and
 * falls back to different prose when the threshold is null — reusing it would
 * silently change the group page (ROK-1478 AC7 forbids that).
 */

/**
 * `DEFAULT_VIABILITY_THRESHOLD`, `playersStillNeeded`, `effectiveLfgState` and
 * `groupLine` moved VERBATIM to `packages/contract/src/lfg-copy.ts` (ROK-1505
 * D5) so the Discord board's thread title is the same sentence as the chip.
 * Re-exported here so no web call site changes; `nowLine` / `chipLabel` stay
 * because they carry the 🔥 / 🎯 the Discord surface does not want.
 */
export {
    DEFAULT_VIABILITY_THRESHOLD,
    effectiveLfgState,
    groupLine,
    playersStillNeeded,
} from '@raid-ledger/contract';
import { groupLine } from '@raid-ledger/contract';

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
    const verb = nowCount === 1 ? 'wants' : 'want';
    return `🔥 ${nowCount} ${verb} to play now`;
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
