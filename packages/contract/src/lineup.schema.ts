import { z } from 'zod';

// ============================================================
// Community Lineup Schemas (ROK-933)
// ============================================================

/** Valid lineup statuses. Flow: building → voting → decided → archived */
export const LineupStatusSchema = z.enum([
    'building',
    'voting',
    'decided',
    'archived',
]);

export type LineupStatusDto = z.infer<typeof LineupStatusSchema>;

// ============================================================
// Request Schemas
// ============================================================

/** Create a new lineup. */
export const CreateLineupSchema = z.object({
    targetDate: z.string().datetime({ offset: true }).nullable().optional(),
});

export type CreateLineupDto = z.infer<typeof CreateLineupSchema>;

/** Transition a lineup to a new status with optional context fields. */
export const UpdateLineupStatusSchema = z.object({
    status: LineupStatusSchema,
    /** Set when transitioning building → voting. */
    votingDeadline: z.string().datetime({ offset: true }).nullable().optional(),
    /** Required when transitioning voting → decided. Must be a game in the lineup entries. */
    decidedGameId: z.number().int().positive().nullable().optional(),
});

export type UpdateLineupStatusDto = z.infer<typeof UpdateLineupStatusSchema>;

// ============================================================
// Response Schemas
// ============================================================

/** Nominator / voter identity embedded in responses. */
const LineupUserSchema = z.object({
    id: z.number(),
    displayName: z.string(),
});

/** A single game nomination within a lineup. */
export const LineupEntryResponseSchema = z.object({
    id: z.number(),
    gameId: z.number(),
    gameName: z.string(),
    gameCoverUrl: z.string().nullable(),
    nominatedBy: LineupUserSchema,
    note: z.string().nullable(),
    carriedOver: z.boolean(),
    voteCount: z.number(),
    createdAt: z.string(),
});

export type LineupEntryResponseDto = z.infer<typeof LineupEntryResponseSchema>;

/** Full lineup detail including entries and vote tallies. */
export const LineupDetailResponseSchema = z.object({
    id: z.number(),
    status: LineupStatusSchema,
    targetDate: z.string().nullable(),
    decidedGameId: z.number().nullable(),
    decidedGameName: z.string().nullable(),
    linkedEventId: z.number().nullable(),
    createdBy: LineupUserSchema,
    votingDeadline: z.string().nullable(),
    entries: z.array(LineupEntryResponseSchema),
    totalVoters: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type LineupDetailResponseDto = z.infer<typeof LineupDetailResponseSchema>;

/** Lightweight lineup summary for lists. */
export const LineupSummaryResponseSchema = z.object({
    id: z.number(),
    status: LineupStatusSchema,
    targetDate: z.string().nullable(),
    entryCount: z.number(),
    totalVoters: z.number(),
    createdAt: z.string(),
});

export type LineupSummaryResponseDto = z.infer<typeof LineupSummaryResponseSchema>;
