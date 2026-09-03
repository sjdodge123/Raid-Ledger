/**
 * ROK-1464 — every user-facing string on the LFG group page.
 *
 * Kept in one module so the page's vocabulary ("Looking for group" vs
 * "Looking for members", the reason chips, the two failure stories) can be
 * reviewed as copy rather than hunted across six components.
 */
import type { LfgSuggestionReason } from '@raid-ledger/contract';

export const LFG_COPY = {
    /** Status label. One person is looking FOR a group; two-plus want members. */
    statusLfg: 'Looking for group',
    statusLfm: 'Looking for members',
    join: "+1 · I'm in",
    withdraw: 'Withdraw',
    findATime: 'Find a time',
    /**
     * `POST /lfg/:id/convert` only flips intents of ACTIVE participants, so a
     * viewer without one would create a poll and then fail the convert —
     * leaving a permanent retry card and live intents behind.
     */
    findATimeNeedsIntent:
        '+1 first — you have to be in the group to start its poll',
    fullGroupPrompt: 'You have a full group — find a time?',
    emptyState: "Nobody's looking for a group right now — be the first",
    overlapTitle: "When everyone's free",
    overlapNeedsTwo: 'Overlap appears once two people are in',
    overlapEmpty: 'No shared window yet — the grid needs more hours in it',
    startPoll: 'Start poll',
    historyTitle: 'Played here before',
    /** Attendance WAS taken for this session and nobody turned up. */
    nobodyAttended: 'nobody attended',
    historyEmpty: 'No sessions logged for this game yet',
    suggestionsTitle: 'Might want in',
    suggestionsEmpty: 'Nobody else to suggest right now',
    invite: 'Invite',
    /** ROK-1455 ships the DM. Until then the button is an inert placeholder. */
    inviteDisabledTitle: 'Invites arrive with ROK-1455',
    /**
     * Links to the WHOLE game detail page (co-op attribution included), so it
     * is not labelled as co-op-only — operator walk, 2026-09-02.
     */
    detailsLink: 'Details ↗',
    notFoundTitle: "We couldn't find that game",
    notFoundBody: 'The link may be stale, or the game was never added here.',
    backToGames: 'Back to Games',
    convertFailed:
        'Poll created, but the group could not be marked as scheduled',
    convertRetry: 'Retry',
    openPoll: 'Open the poll',
    suggestFailed:
        'Poll created, but that time was not pre-filled — add it on the poll page',
    findATimeFailed: 'Could not create the poll',
} as const;

/** Chip text for why a player was suggested. */
export const REASON_CHIP: Record<LfgSuggestionReason, string> = {
    played: 'played before',
    owns: 'owns it',
    hearted: 'hearted it',
};

/** One-line explanation under a suggestion, keyed by its strongest reason. */
export const REASON_SUBTITLE: Record<LfgSuggestionReason, string> = {
    played: 'Has played this with the group',
    owns: 'Already has it in their library',
    hearted: 'Hearted this game',
};

/**
 * The line under the count. States what is MISSING rather than guessing a
 * number: with no viability threshold there is no "needs N" figure to print
 * (D5), so the copy falls back to the qualitative nudge.
 */
export function lookingLine(
    activeCount: number,
    viabilityThreshold: number | null,
): string {
    const missing =
        viabilityThreshold != null ? viabilityThreshold - activeCount : null;
    if (missing != null && missing > 0) {
        return `${activeCount} looking · needs ${missing} more`;
    }
    if (activeCount === 1) {
        return '1 looking — one more makes it a group';
    }
    return `${activeCount} looking`;
}
