import { z } from 'zod';

/**
 * Standalone poll visibility (ROK-1750). `private` = "Private — anyone with
 * the link": only the creator, picked members and link redeemers may view or
 * vote, and the poll carries a 256-bit share token.
 */
export const StandalonePollVisibilitySchema = z.enum(['public', 'private']);

export type StandalonePollVisibility = z.infer<typeof StandalonePollVisibilitySchema>;

// ============================================================
// Standalone Scheduling Poll Schemas (ROK-977)
// ============================================================

/**
 * Request body for creating a standalone scheduling poll.
 * Skips the full lineup flow (building/voting) and jumps directly
 * to scheduling with a pre-selected game.
 */
export const CreateSchedulingPollSchema = z.object({
    /** ID of the game to schedule. Must exist in the games table. */
    gameId: z.number().int().positive(),
    /** Optional linked event ID (e.g. for reschedule flow). */
    linkedEventId: z.number().int().positive().optional(),
    /** Duration in hours before auto-archiving (1-720). Defaults to 2 weeks. */
    durationHours: z.number().int().min(1).max(720).optional(),
    /** Optional list of user IDs to add as match members. */
    memberUserIds: z.array(z.number().int().positive()).optional(),
    /** Minimum unique voters before organizer is notified (ROK-1015). */
    minVoteThreshold: z.number().int().positive().optional(),
    /** ROK-1750: poll visibility. Absent = `public`. */
    visibility: StandalonePollVisibilitySchema.optional(),
}).refine((d) => !(d.visibility === 'private' && d.linkedEventId !== undefined), {
    message: 'A reschedule poll (linkedEventId) cannot be private',
    path: ['visibility'],
});

export type CreateSchedulingPollDto = z.infer<typeof CreateSchedulingPollSchema>;

/**
 * ROK-1844: request body for `POST /scheduling-polls/:matchId/complete`.
 * Strict — an unknown key is a 400. `eventId` is the event the poll's
 * yes-voters are auto-signed up to (the linked event, or one created from the
 * poll); `startTime` is the winning slot's instant.
 */
export const CompleteSchedulingPollSchema = z.object({
    eventId: z.number().int().positive().optional(),
    startTime: z.string().datetime({ offset: true }).optional(),
}).strict();

export type CompleteSchedulingPollDto = z.infer<typeof CompleteSchedulingPollSchema>;

/**
 * Response from creating a standalone scheduling poll.
 * Returns the match and lineup identifiers needed to navigate
 * to the scheduling poll page.
 */
export const SchedulingPollResponseSchema = z.object({
    /** The match ID (primary identifier for the scheduling poll). */
    id: z.number(),
    /** The lineup ID (needed for URL routing). */
    lineupId: z.number(),
    /** The game ID selected for scheduling. */
    gameId: z.number(),
    /** Display name of the game. */
    gameName: z.string(),
    /** Cover image URL for the game (null if none). */
    gameCoverUrl: z.string().nullable(),
    /** Number of members in the match. */
    memberCount: z.number(),
    /** Always 'scheduling' for standalone polls. */
    status: z.literal('scheduling'),
    /** ISO datetime when the poll was created. */
    createdAt: z.string().datetime(),
    /** ROK-1750: poll visibility. */
    visibility: StandalonePollVisibilitySchema,
    /** ROK-1750: share token — non-null only for a private poll. */
    shareToken: z.string().nullable(),
});

export type SchedulingPollResponseDto = z.infer<typeof SchedulingPollResponseSchema>;

/**
 * Shape returned by GET /scheduling-polls/active.
 * Each entry represents an in-progress standalone scheduling poll.
 */
export const ActiveStandalonePollSchema = z.object({
    /** The match ID (primary identifier for the scheduling poll). */
    matchId: z.number(),
    /** The lineup ID (needed for URL routing). */
    lineupId: z.number(),
    /** Display name of the game being scheduled. */
    gameName: z.string(),
    /** Cover image URL for the game (null if none). */
    gameCoverUrl: z.string().nullable(),
    /** Number of members in the match. */
    memberCount: z.number(),
    /** Number of proposed time slots. */
    slotCount: z.number(),
    /** ROK-1750: poll visibility (drives the banner's Private chip). */
    visibility: StandalonePollVisibilitySchema.optional(),
});

export type ActiveStandalonePollDto = z.infer<typeof ActiveStandalonePollSchema>;

// ============================================================
// Private poll share links (ROK-1750)
// ============================================================

/**
 * Un-authed preview for GET /scheduling-polls/share/:token. Deliberately
 * minimal (ROK-1629 projection rule): no voter names, slot times or
 * Discord ids.
 */
export const PollSharePreviewSchema = z.object({
    gameName: z.string(),
    gameCoverUrl: z.string().nullable(),
    creatorDisplayName: z.string(),
    /** False once the poll is locked in, cancelled or expired. */
    isOpen: z.boolean(),
    memberCount: z.number().int().nonnegative(),
});

export type PollSharePreviewDto = z.infer<typeof PollSharePreviewSchema>;

/**
 * Response from POST /scheduling-polls/share/:token/join. `joined` is false
 * when the caller was already in, is the creator, or the poll is closed.
 */
export const PollShareJoinResponseSchema = z.object({
    lineupId: z.number().int().positive(),
    matchId: z.number().int().positive(),
    joined: z.boolean(),
});

export type PollShareJoinResponseDto = z.infer<typeof PollShareJoinResponseSchema>;

/** Response from POST /scheduling-polls/:matchId/share-token/reset. */
export const PollShareTokenResponseSchema = z.object({
    shareToken: z.string().min(1),
});

export type PollShareTokenResponseDto = z.infer<typeof PollShareTokenResponseSchema>;
