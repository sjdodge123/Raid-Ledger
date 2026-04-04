import { z } from 'zod';

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
    /** Optional duration in hours before auto-archiving (1-720). */
    durationHours: z.number().int().min(1).max(720).optional(),
    /** Optional list of user IDs to add as match members. */
    memberUserIds: z.array(z.number().int().positive()).optional(),
});

export type CreateSchedulingPollDto = z.infer<typeof CreateSchedulingPollSchema>;

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
});

export type SchedulingPollResponseDto = z.infer<typeof SchedulingPollResponseSchema>;
