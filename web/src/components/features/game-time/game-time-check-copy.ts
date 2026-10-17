/**
 * The copy and button recipes every game-time check surface shares (ROK-1569).
 *
 * There are now two step-1 bodies — the desktop modal's four answers
 * (`pages/scheduling/GameTimeCheckBody.tsx`) and the phone's week editor
 * (`phone/PhoneWeekCheckStep.tsx`) — and they must ask the SAME question with
 * the SAME words. The prompt and the answer geometry live here so neither
 * surface re-types either one.
 *
 * No new pattern: the recipes are lifted verbatim from the shipped
 * `GameTimeCheckBody` answers — the `border-edge-strong` outline on `bg-surface`
 * with a `hover:bg-panel` token hover, and the emerald primary the game-time
 * Save button already used. Every colour is a token or a hue with a light-family
 * override in `index.css`; nothing is hardcoded.
 */

/** Shared answer geometry: full-width, 44px tall, left-aligned label + hint. */
export const ANSWER_BASE =
    'w-full min-h-[44px] rounded-lg px-4 py-2.5 text-left text-sm font-medium transition-colors';

/** Outline answer — "I'm away…", "Edit my week". */
export const ANSWER_SECONDARY =
    `${ANSWER_BASE} border border-edge-strong bg-surface text-foreground hover:bg-panel`;

/** The one-tap answer — "Looks right" / "Same as last week" / "Save my week". */
export const ANSWER_PRIMARY =
    `${ANSWER_BASE} bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50`;

/**
 * Copy for the one question the check asks.
 *
 * @param ageDays Whole days since the last confirmation; `null` = never confirmed.
 * @param hasSlots Whether the viewer has any saved template — a never-confirmed
 *   user WITH slots (pre-ROK-999 data) has a week, just an unconfirmed one.
 * @returns The prompt line, ready to render.
 */
export function gameTimeCheckPrompt(ageDays: number | null | undefined, hasSlots: boolean): string {
    if (ageDays === null || ageDays === undefined) {
        return hasSlots
            ? "Your game time hasn't been confirmed yet. Anything changed?"
            : "You haven't set a game time yet. Anything to add?";
    }
    return `Your game time is ${ageDays} days old. Anything changed?`;
}
