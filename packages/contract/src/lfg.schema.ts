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
