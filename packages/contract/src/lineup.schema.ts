import { z } from 'zod';

// Re-export match & scheduling schemas for backward compatibility (ROK-975)
export * from './lineup-match.schema.js';

// ============================================================
// Community Lineup Schemas (ROK-933)
// ============================================================

/** Valid lineup statuses. Flow: building -> voting -> decided -> scheduling -> archived */
export const LineupStatusSchema = z.enum([
    'building',
    'voting',
    'decided',
    'scheduling',
    'archived',
]);

export type LineupStatusDto = z.infer<typeof LineupStatusSchema>;

// ============================================================
// Request Schemas
// ============================================================

/** Create a new lineup. */
export const CreateLineupSchema = z.object({
    targetDate: z.string().datetime({ offset: true }).nullable().optional(),
    /** Hours for the building phase (1-720, default from admin settings). */
    buildingDurationHours: z.number().int().min(1).max(720).optional(),
    /** Hours for the voting phase (1-720, default from admin settings). */
    votingDurationHours: z.number().int().min(1).max(720).optional(),
    /** Hours for the decided phase (1-720, default from admin settings). */
    decidedDurationHours: z.number().int().min(1).max(720).optional(),
    /** Match threshold percentage for grouping algorithm (0–100, default 35). */
    matchThreshold: z.number().int().min(0).max(100).optional(),
    /** Max votes each player can cast during voting (1–10, default 3). */
    votesPerPlayer: z.number().int().min(1).max(10).optional(),
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
    /** How many community members own this game (source=steam_library). */
    ownerCount: z.number(),
    /** Total registered community members. */
    totalMembers: z.number(),
    /** Members who do NOT own this game. */
    nonOwnerCount: z.number(),
    /** Members who have this game on their Steam wishlist. */
    wishlistCount: z.number(),
    /** Current best deal price from ITAD. */
    itadCurrentPrice: z.number().nullable(),
    /** Discount percentage (0-100). */
    itadCurrentCut: z.number().nullable(),
    /** Store name offering the current deal. */
    itadCurrentShop: z.string().nullable(),
    /** URL to the current deal. */
    itadCurrentUrl: z.string().nullable(),
    /** Min/max player count from IGDB (null if unknown). */
    playerCount: z.object({ min: z.number(), max: z.number() }).nullable(),
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
    phaseDeadline: z.string().nullable(),
    matchThreshold: z.number().nullable(),
    /** Max votes each player can cast during voting (ROK-976). */
    maxVotesPerPlayer: z.number(),
    entries: z.array(LineupEntryResponseSchema),
    totalVoters: z.number(),
    totalMembers: z.number(),
    /** Game IDs the current user has voted for (ROK-936). */
    myVotes: z.array(z.number()),
    /** Count of members without a linked Steam account (ROK-993). */
    unlinkedSteamCount: z.number(),
    /** Members without a linked Steam account (ROK-993, operator-only). */
    unlinkedSteamMembers: z.array(z.object({ id: z.number(), displayName: z.string() })),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type LineupDetailResponseDto = z.infer<typeof LineupDetailResponseSchema>;

/** Banner entry — lightweight game summary for the banner. */
const LineupBannerEntrySchema = z.object({
    gameId: z.number(),
    gameName: z.string(),
    gameCoverUrl: z.string().nullable(),
    ownerCount: z.number(),
    voteCount: z.number(),
});

/** Lightweight banner data for the Games page hero. */
export const LineupBannerResponseSchema = z.object({
    id: z.number(),
    status: LineupStatusSchema,
    targetDate: z.string().nullable(),
    phaseDeadline: z.string().nullable(),
    entryCount: z.number(),
    totalVoters: z.number(),
    totalMembers: z.number(),
    decidedGameName: z.string().nullable(),
    entries: z.array(LineupBannerEntrySchema),
});

export type LineupBannerResponseDto = z.infer<typeof LineupBannerResponseSchema>;

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

// ============================================================
// Common Ground Schemas (ROK-934)
// ============================================================

/** Query params for the Common Ground endpoint. */
export const CommonGroundQuerySchema = z.object({
    /** Minimum library owners. 0 = show all games (including unowned). */
    minOwners: z.coerce.number().int().min(0).max(15).default(2),
    maxPlayers: z.coerce.number().int().positive().optional(),
    genre: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
});

export type CommonGroundQueryDto = z.infer<typeof CommonGroundQuerySchema>;

/** Body for nominating a game into a lineup. */
export const NominateGameSchema = z.object({
    gameId: z.number().int().positive(),
    note: z.string().max(200).optional(),
});

/** Body for casting / toggling a vote on a nominated game (ROK-936). */
export const CastVoteSchema = z.object({
    gameId: z.number().int().positive(),
});

export type CastVoteDto = z.infer<typeof CastVoteSchema>;

export type NominateGameDto = z.infer<typeof NominateGameSchema>;

/** A single game in the Common Ground response. */
export const CommonGroundGameSchema = z.object({
    gameId: z.number(),
    gameName: z.string(),
    slug: z.string(),
    coverUrl: z.string().nullable(),
    ownerCount: z.number(),
    wishlistCount: z.number(),
    nonOwnerPrice: z.number().nullable(),
    itadCurrentCut: z.number().nullable(),
    itadCurrentShop: z.string().nullable(),
    itadCurrentUrl: z.string().nullable(),
    earlyAccess: z.boolean(),
    itadTags: z.array(z.string()),
    playerCount: z.object({ min: z.number(), max: z.number() }).nullable(),
    score: z.number(),
});

export type CommonGroundGameDto = z.infer<typeof CommonGroundGameSchema>;

/** Full Common Ground response with metadata. */
export const CommonGroundResponseSchema = z.object({
    data: z.array(CommonGroundGameSchema),
    meta: z.object({
        total: z.number(),
        appliedWeights: z.object({
            ownerWeight: z.number(),
            saleBonus: z.number(),
            fullPricePenalty: z.number(),
        }),
        activeLineupId: z.number(),
        nominatedCount: z.number(),
        maxNominations: z.number(),
    }),
});

export type CommonGroundResponseDto = z.infer<typeof CommonGroundResponseSchema>;
