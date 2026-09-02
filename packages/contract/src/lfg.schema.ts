import { z } from 'zod';

// ============================================================
// LFG Intents (ROK-1451)
// ============================================================
//
// LFG vs LFM is DERIVED, never stored: count the active intents for a game —
// 1 → 'lfg', >= 2 → 'lfm', 0 → null. There is no state column and no join
// mechanic; player B posting an intent on a game where A already has one IS
// the LFG → LFM transition.

/** Lifecycle states an intent row can hold (mirrors the DB CHECK constraint). */
export const LfgIntentStatusSchema = z.enum([
    'active',
    'cleared',
    'converted',
    'expired',
]);
export type LfgIntentStatus = z.infer<typeof LfgIntentStatusSchema>;

/** Relay seam (ROK-274). Only `local` is implemented in v1. */
export const LfgVisibilitySchema = z.enum(['local', 'cross-community']);
export type LfgVisibility = z.infer<typeof LfgVisibilitySchema>;

/** Derived group state. `null` when nobody is actively looking. */
export const LfgStateSchema = z.enum(['lfg', 'lfm']).nullable();
export type LfgState = z.infer<typeof LfgStateSchema>;

/**
 * Request body for `POST /lfg`.
 * `visibility` is deliberately NOT accepted — every intent ships as `local`
 * until ROK-274 wires the cross-community relay toggle.
 */
export const CreateLfgIntentSchema = z.object({
    /** ID of the game the caller wants to play. Must exist in `games`. */
    gameId: z.number().int().positive(),
});
export type CreateLfgIntentDto = z.infer<typeof CreateLfgIntentSchema>;

/**
 * Request body for `POST /lfg/:gameId/convert`.
 * Exactly one of `pollId` / `eventId` is required — the caller creates the
 * poll or event first and reports the provenance here.
 */
export const ConvertLfgIntentsSchema = z
    .object({
        /** `community_lineup_matches.id` the group converted into. */
        pollId: z.number().int().positive().optional(),
        /** `events.id` the group converted into. */
        eventId: z.number().int().positive().optional(),
    })
    .refine((v) => (v.pollId === undefined) !== (v.eventId === undefined), {
        message: 'Supply exactly one of pollId or eventId',
    });
export type ConvertLfgIntentsDto = z.infer<typeof ConvertLfgIntentsSchema>;

/** Response from `POST /lfg/:gameId/convert`. */
export const LfgConvertResponseSchema = z.object({
    /** How many active intents flipped to `converted`. Zero is not an error. */
    converted: z.number().int().nonnegative(),
});
export type LfgConvertResponseDto = z.infer<typeof LfgConvertResponseSchema>;

/** A single LFG intent row as returned to clients. */
export const LfgIntentSchema = z.object({
    id: z.number(),
    userId: z.number(),
    gameId: z.number(),
    status: LfgIntentStatusSchema,
    visibility: LfgVisibilitySchema,
    createdAt: z.string(),
    expiresAt: z.string(),
    /** Provenance — set when the group converted into a scheduling poll. */
    convertedToPollId: z.number().nullable(),
    /** Provenance — set when the group converted into an event. */
    convertedToEventId: z.number().nullable(),
});
export type LfgIntentDto = z.infer<typeof LfgIntentSchema>;

/** Derived per-game group summary. Everything here is computed, never stored. */
export const LfgGroupSummarySchema = z.object({
    gameId: z.number(),
    gameName: z.string(),
    gameCoverUrl: z.string().nullable(),
    /** Active intents held by non-deactivated, non-banned users. */
    activeCount: z.number(),
    state: LfgStateSchema,
    /** `games.cooptimusOnlineMax`, or null when there is no Co-Optimus data. */
    viabilityThreshold: z.number().nullable(),
    /** `threshold !== null && activeCount >= threshold`. Never acted on. */
    isViable: z.boolean(),
    hasOwnIntent: z.boolean(),
    soonestExpiresAt: z.string().nullable(),
});
export type LfgGroupSummaryDto = z.infer<typeof LfgGroupSummarySchema>;

/** A visible member of an LFG/LFM group. */
export const LfgMemberSchema = z.object({
    userId: z.number(),
    username: z.string(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    expiresAt: z.string(),
    joinedAt: z.string(),
});
export type LfgMemberDto = z.infer<typeof LfgMemberSchema>;

/** `GET /lfg/:gameId` — the summary plus the roster and the caller's own row. */
export const LfgGroupDetailSchema = LfgGroupSummarySchema.extend({
    members: z.array(LfgMemberSchema),
    ownIntent: LfgIntentSchema.nullable(),
});
export type LfgGroupDetailDto = z.infer<typeof LfgGroupDetailSchema>;

/** `POST /lfg` — the intent plus the derived group, so callers render at once. */
export const LfgIntentResponseSchema = LfgIntentSchema.extend({
    group: LfgGroupSummarySchema,
});
export type LfgIntentResponseDto = z.infer<typeof LfgIntentResponseSchema>;

/** `GET /lfg/hearted` — cold-start suggestions from the caller's manual hearts. */
export const LfgHeartedGameSchema = z.object({
    gameId: z.number(),
    gameName: z.string(),
    gameCoverUrl: z.string().nullable(),
    heartedAt: z.string(),
    /** How many other people are already looking for this game. */
    activeCount: z.number(),
});
export type LfgHeartedGameDto = z.infer<typeof LfgHeartedGameSchema>;

/**
 * `GET /lfg/offers` — a Quick Play session the caller took part in AFTER
 * raising their hand for that game (ROK-1451 AC7).
 *
 * Fully DERIVED: no column, no table, no dismissal state. The offer is inert —
 * clearing happens only when the player calls `DELETE /lfg/:gameId`, so a
 * dismissed offer is simply one that was never acted on.
 */
export const LfgClearOfferSchema = z.object({
    gameId: z.number(),
    gameName: z.string(),
    gameCoverUrl: z.string().nullable(),
    /** The still-active intent this offer would clear. */
    intentId: z.number(),
    /** The ad-hoc / Quick Play event that triggered the offer. */
    eventId: z.number(),
    /** When the caller was recorded as a participant in that session. */
    playedAt: z.string(),
});
export type LfgClearOfferDto = z.infer<typeof LfgClearOfferSchema>;

// ============================================================
// LFG group-page reads (ROK-1463)
// ============================================================
//
// Three derived reads for the group page. All are read-only projections over
// existing tables — nothing here creates, clears or converts an intent.

/**
 * One contiguous block of time the group could play in.
 * `start` / `end` are offset-bearing ISO instants, so `start` can be seeded
 * straight into `SuggestSlotSchema.proposedTime`.
 *
 * The underlying game-time grid stores each member's LOCAL wall clock, so the
 * instants here are the result of converting every member's hours out of
 * THEIR timezone (`user_preferences.timezone`, falling back to
 * `app_settings.default_timezone`). Render them in the viewer's zone.
 */
export const LfgOverlapWindowSchema = z.object({
    start: z.string(),
    end: z.string(),
    /** Members free for EVERY hour of the window. */
    availableCount: z.number(),
    /** Live roster size — `availableCount < totalCount` marks a fallback window. */
    totalCount: z.number(),
    /** The `availableCount` member ids, ascending. */
    members: z.array(z.number()),
});
export type LfgOverlapWindowDto = z.infer<typeof LfgOverlapWindowSchema>;

/** `GET /lfg/:gameId/overlap` — "when everyone's free". */
export const LfgOverlapResponseSchema = z.object({
    gameId: z.number(),
    /** Live roster size the windows were computed against. */
    memberCount: z.number(),
    /** Days of grid projected forward from now. */
    horizonDays: z.number(),
    /** Best windows, ranked. Empty below two live members. */
    windows: z.array(LfgOverlapWindowSchema),
});
export type LfgOverlapResponseDto = z.infer<typeof LfgOverlapResponseSchema>;

/**
 * One past session for the game — a scheduled event or a Quick Play run.
 *
 * Quick Play entries appear only once the session is finalised (`ended`); a
 * session still live or in its grace period is not history yet.
 */
export const LfgHistoryEntrySchema = z.object({
    eventId: z.number(),
    title: z.string(),
    /** True for a Quick Play (ad-hoc) session. */
    isAdHoc: z.boolean(),
    startedAt: z.string(),
    endedAt: z.string(),
    durationMinutes: z.number(),
    /** Eligible users recorded as having actually played. */
    attendedCount: z.number(),
    /** Eligible users who signed up — the fallback when attendance was never recorded. */
    signedUpCount: z.number(),
    /**
     * Ids behind `attendedCount`, falling back to the signed-up roster ONLY
     * when no attendance was ever recorded on the event (N2 / Codex #12).
     *
     * The two sources are NOT interchangeable, and the count alone does not
     * tell them apart: an EMPTY list with `signedUpCount > 0` means attendance
     * WAS taken and nobody turned up, while a non-empty list with
     * `attendedCount === 0` means these are people who said they would come,
     * not people confirmed to have played. `attendedCount === participantIds
     * .length` is the "confirmed" case.
     */
    participantIds: z.array(z.number()),
});
export type LfgHistoryEntryDto = z.infer<typeof LfgHistoryEntrySchema>;

/**
 * `GET /lfg/:gameId/history` — "played here before".
 *
 * Ordered by the session's END instant, newest first (S5) — NOT by start. A
 * long event that began earlier therefore outranks a short one that began
 * later but finished first, which is the ordering "most recently played
 * together" actually means.
 */
export const LfgHistoryResponseSchema = z.object({
    gameId: z.number(),
    entries: z.array(LfgHistoryEntrySchema),
});
export type LfgHistoryResponseDto = z.infer<typeof LfgHistoryResponseSchema>;

/** Why a player was suggested. A player may carry several reasons. */
export const LfgSuggestionReasonSchema = z.enum(['played', 'owns', 'hearted']);
export type LfgSuggestionReason = z.infer<typeof LfgSuggestionReasonSchema>;

/** A player who might want in on this group. */
export const LfgSuggestionSchema = z.object({
    userId: z.number(),
    username: z.string(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    /** At least one. Ordered played → owns → hearted. */
    reasons: z.array(LfgSuggestionReasonSchema),
    /** Null when they never played it, or opted out of activity sharing. */
    lastPlayedAt: z.string().nullable(),
});
export type LfgSuggestionDto = z.infer<typeof LfgSuggestionSchema>;

/** `GET /lfg/:gameId/suggestions` — "might want in". */
export const LfgSuggestionsResponseSchema = z.object({
    gameId: z.number(),
    suggestions: z.array(LfgSuggestionSchema),
});
export type LfgSuggestionsResponseDto = z.infer<
    typeof LfgSuggestionsResponseSchema
>;
