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
    /**
     * ROK-1479 — the urgency choice. Raising a hand is now a two-step click:
     * pick the game, then say WHEN. The three labels are the only vocabulary
     * for it, so every surface that offers the choice reads them from here.
     */
    urgencyPrompt: 'When do you want to play?',
    /** The original ROK-1451 intent: quiet, 14 days. */
    urgencyWeek: 'This week',
    /** A `now` intent with a 30-minute TTL. */
    urgencyNow30: 'Right now · 30 min',
    /** A `now` intent with a 60-minute TTL. */
    urgencyNow60: 'Right now · 1 hour',
    /**
     * ROK-1479 A7 — the strip above the avatar row listing the members who
     * want to play RIGHT NOW, soonest to lapse first.
     */
    nowStripTitle: 'Right now',
    /**
     * ROK-1494 A7 — the playing-now state. Once a `now` group spawns its ad-hoc
     * event the intents are CONVERTED, so `activeCount` is 0 and the page would
     * otherwise read "Nobody's looking" while the group is mid-session (D9).
     * Copy proposals — flagged to the operator in the PR body.
     */
    playingNowTitle: 'Playing now',
    playingNowJoinVoice: 'Join voice',
    playingNowOpenEvent: 'Open the event',
    /**
     * ROK-1483 — the LFG page's heading for the mirrored Discord thread.
     *
     * Only the heading lives here. The strings INSIDE the viewer (its empty
     * state and its Discord link) are owned by `ThreadedChatViewer`'s own
     * surface-agnostic vocabulary, because ROK-1484 mounts that component on
     * a lineup and a poll where "LFG" would be wrong. Duplicating them here
     * would give one on-screen sentence two sources of truth, only one of
     * which renders — so do not re-add them.
     */
    conversationTitle: 'Conversation',
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

/** Below this much remaining, a countdown renders in whole seconds. */
export const SECONDS_GRANULARITY_MS = 120_000;

/**
 * How long a `now` intent has left, in words (ROK-1479 A7/A8).
 *
 * Minutes are FLOORED, so the line reads "at least N minutes" and never
 * promises time that is not there; under two minutes it switches to whole
 * seconds, which is the point at which a minute figure stops being useful.
 * A lapsed instant clamps to zero rather than going negative — the reads drop
 * the member on the next fetch, and a "-3s left" chip in between is a bug the
 * viewer can see.
 *
 * @param remainingMs - `expiresAt` minus the shared tick's `now`.
 */
export function expiresIn(remainingMs: number): string {
    const remaining = Math.max(0, remainingMs);
    if (remaining < SECONDS_GRANULARITY_MS) {
        return `${Math.floor(remaining / 1_000)}s left`;
    }
    return `${Math.floor(remaining / 60_000)} min left`;
}

/**
 * One chip of the "Right now" strip: who, and how long they are up for.
 *
 * @param name - The member's display name, or their username.
 * @param remaining - The formatted countdown from {@link expiresIn}.
 */
export function nowChip(name: string, remaining: string): string {
    return `🔥 ${name} · ${remaining}`;
}

/**
 * The live head-count line of the playing-now card (ROK-1494 AC4).
 *
 * Reads the count off the EVENT's roster, so it counts voice joiners who never
 * held an LFG intent — hence "in voice" rather than "looking".
 *
 * @param count - `playingNow.participantCount`, ad-hoc participants who have
 *   not left.
 */
export function playingNowCount(count: number): string {
    return `${count} in voice`;
}
