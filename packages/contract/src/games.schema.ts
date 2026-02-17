import { z } from 'zod';

// Query parameters for game search
export const GameSearchQuerySchema = z.object({
    q: z.string().min(1).max(100),
});

export type GameSearchQueryDto = z.infer<typeof GameSearchQuerySchema>;

// Individual game from IGDB (cached locally) — basic fields
export const IgdbGameSchema = z.object({
    id: z.number(),
    igdbId: z.number(),
    name: z.string(),
    slug: z.string(),
    coverUrl: z.string().nullable(),
});

export type IgdbGameDto = z.infer<typeof IgdbGameSchema>;

// Response for game search endpoint
export const GameSearchResponseSchema = z.object({
    data: z.array(IgdbGameSchema),
    meta: z.object({
        total: z.number(),
        cached: z.boolean(),
        source: z.enum(['redis', 'database', 'igdb', 'local']).optional(),
    }),
});

export type GameSearchResponseDto = z.infer<typeof GameSearchResponseSchema>;

// ============================================================
// ROK-229: Expanded game schemas for discovery
// ============================================================

/** Full game detail with all IGDB metadata */
export const GameDetailSchema = z.object({
    id: z.number(),
    igdbId: z.number(),
    name: z.string(),
    slug: z.string(),
    coverUrl: z.string().nullable(),
    genres: z.array(z.number()).default([]),
    summary: z.string().nullable(),
    rating: z.number().nullable(),
    aggregatedRating: z.number().nullable(),
    popularity: z.number().nullable(),
    gameModes: z.array(z.number()).default([]),
    themes: z.array(z.number()).default([]),
    platforms: z.array(z.number()).default([]),
    screenshots: z.array(z.string()).default([]),
    videos: z.array(z.object({
        name: z.string(),
        videoId: z.string(),
    })).default([]),
    firstReleaseDate: z.string().nullable(),
    playerCount: z.object({
        min: z.number(),
        max: z.number(),
    }).nullable(),
    twitchGameId: z.string().nullable(),
    crossplay: z.boolean().nullable(),
});

export type GameDetailDto = z.infer<typeof GameDetailSchema>;

/** Discovery page query parameters */
export const GameDiscoverQuerySchema = z.object({
    genre: z.coerce.number().optional(),
});

export type GameDiscoverQueryDto = z.infer<typeof GameDiscoverQuerySchema>;

/** A category row in the discovery response */
export const GameDiscoverRowSchema = z.object({
    category: z.string(),
    slug: z.string(),
    games: z.array(GameDetailSchema),
});

export type GameDiscoverRowDto = z.infer<typeof GameDiscoverRowSchema>;

/** Discovery endpoint response */
export const GameDiscoverResponseSchema = z.object({
    rows: z.array(GameDiscoverRowSchema),
});

export type GameDiscoverResponseDto = z.infer<typeof GameDiscoverResponseSchema>;

/** Twitch stream info */
export const TwitchStreamSchema = z.object({
    userName: z.string(),
    title: z.string(),
    viewerCount: z.number(),
    thumbnailUrl: z.string(),
    language: z.string(),
});

export type TwitchStreamDto = z.infer<typeof TwitchStreamSchema>;

/** Streams endpoint response */
export const GameStreamsResponseSchema = z.object({
    streams: z.array(TwitchStreamSchema),
    totalLive: z.number(),
});

export type GameStreamsResponseDto = z.infer<typeof GameStreamsResponseSchema>;

// ============================================================
// ROK-173: Admin IGDB panel schemas
// ============================================================

/** IGDB sync status for admin panel */
export const IgdbSyncStatusSchema = z.object({
    lastSyncAt: z.string().nullable(),
    gameCount: z.number(),
    syncInProgress: z.boolean(),
});

export type IgdbSyncStatusDto = z.infer<typeof IgdbSyncStatusSchema>;

/** IGDB connection health for admin panel */
export const IgdbHealthStatusSchema = z.object({
    tokenStatus: z.enum(['valid', 'expired', 'not_fetched']),
    tokenExpiresAt: z.string().nullable(),
    lastApiCallAt: z.string().nullable(),
    lastApiCallSuccess: z.boolean().nullable(),
});

export type IgdbHealthStatusDto = z.infer<typeof IgdbHealthStatusSchema>;

/** Admin game list query parameters */
export const AdminGameListQuerySchema = z.object({
    search: z.string().optional(),
    showHidden: z.enum(['only', 'true']).optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
});

export type AdminGameListQueryDto = z.infer<typeof AdminGameListQuerySchema>;

/** Admin game list response */
export const AdminGameListResponseSchema = z.object({
    data: z.array(z.object({
        id: z.number(),
        igdbId: z.number(),
        name: z.string(),
        slug: z.string(),
        coverUrl: z.string().nullable(),
        cachedAt: z.string(),
        hidden: z.boolean(),
        banned: z.boolean(),
    })),
    meta: z.object({
        total: z.number(),
        page: z.number(),
        limit: z.number(),
        totalPages: z.number(),
        hasMore: z.boolean(),
    }),
});

export type AdminGameListResponseDto = z.infer<typeof AdminGameListResponseSchema>;

/** Player preview for game interest avatars (ROK-282) */
export const InterestPlayerPreviewSchema = z.object({
    id: z.number(),
    username: z.string(),
    avatar: z.string().nullable(),
    customAvatarUrl: z.string().nullable(),
    discordId: z.string().nullable(),
});

export type InterestPlayerPreviewDto = z.infer<typeof InterestPlayerPreviewSchema>;

/** Game interest (want-to-play) */
export const GameInterestResponseSchema = z.object({
    wantToPlay: z.boolean(),
    count: z.number(),
    /** First N interested players for avatar display (ROK-282) */
    players: z.array(InterestPlayerPreviewSchema).optional(),
});

export type GameInterestResponseDto = z.infer<typeof GameInterestResponseSchema>;

/** ROK-362: Batch interest check response — map of gameId to interest status */
export const BatchInterestResponseSchema = z.object({
    data: z.record(z.string(), z.object({
        wantToPlay: z.boolean(),
        count: z.number(),
    })),
});

export type BatchInterestResponseDto = z.infer<typeof BatchInterestResponseSchema>;

/** A game the user has hearted, with basic info for display (ROK-282) */
export const UserHeartedGameSchema = z.object({
    id: z.number(),
    igdbId: z.number(),
    name: z.string(),
    slug: z.string(),
    coverUrl: z.string().nullable(),
});

export type UserHeartedGameDto = z.infer<typeof UserHeartedGameSchema>;

/** Response for user hearted games endpoint (ROK-282) */
export const UserHeartedGamesResponseSchema = z.object({
    data: z.array(UserHeartedGameSchema),
});

export type UserHeartedGamesResponseDto = z.infer<typeof UserHeartedGamesResponseSchema>;
