import { z } from 'zod';

// Query parameters for game search
export const GameSearchQuerySchema = z.object({
    q: z.string().min(1).max(100),
});

export type GameSearchQueryDto = z.infer<typeof GameSearchQuerySchema>;

// Individual game from IGDB (cached locally) — basic fields
export const IgdbGameSchema = z.object({
    id: z.number(),
    /** ROK-400: nullable for non-IGDB games (e.g., manually created "Generic" game) */
    igdbId: z.number().nullable(),
    name: z.string(),
    slug: z.string(),
    coverUrl: z.string().nullable(),
    /** ROK-1031: Player count for max-attendees auto-populate. */
    playerCount: z.object({ min: z.number(), max: z.number() }).nullable().optional(),
});

export type IgdbGameDto = z.infer<typeof IgdbGameSchema>;

// ============================================================
// ROK-229: Expanded game schemas for discovery
// ============================================================

/** Full game detail with all IGDB metadata */
export const GameDetailSchema = z.object({
    id: z.number(),
    igdbId: z.number().nullable(),
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
        name: z.string().optional(),
        videoId: z.string(),
    })).default([]),
    firstReleaseDate: z.string().nullable(),
    playerCount: z.object({
        min: z.number(),
        max: z.number(),
    }).nullable(),
    twitchGameId: z.string().nullable(),
    crossplay: z.boolean().nullable(),
    /** ROK-772: ITAD game UUID */
    itadGameId: z.string().nullable().optional(),
    /** ROK-773: ITAD boxart URL (fallback when no IGDB cover) */
    itadBoxartUrl: z.string().nullable().optional(),
    /** ROK-773: ITAD tags (genre-like labels from ITAD) */
    itadTags: z.array(z.string()).optional(),
    /** ROK-818: Current best deal price from ITAD */
    itadCurrentPrice: z.number().nullable().optional(),
    /** ROK-818: Current discount percentage (0-100) */
    itadCurrentCut: z.number().nullable().optional(),
    /** ROK-818: Store name offering the current deal */
    itadCurrentShop: z.string().nullable().optional(),
    /** ROK-818: URL to the current deal */
    itadCurrentUrl: z.string().nullable().optional(),
    /** ROK-818: Historical lowest price ever */
    itadLowestPrice: z.number().nullable().optional(),
    /** ROK-818: Historical lowest discount percentage (0-100) */
    itadLowestCut: z.number().nullable().optional(),
    /** ROK-818: Last successful ITAD pricing sync timestamp */
    itadPriceUpdatedAt: z.string().nullable().optional(),
    /** ROK-934: Whether this game is in early access (from ITAD) */
    earlyAccess: z.boolean().optional(),
});

export type GameDetailDto = z.infer<typeof GameDetailSchema>;

// Response for game search endpoint (ROK-375: now returns full GameDetailDto)
export const GameSearchResponseSchema = z.object({
    data: z.array(GameDetailSchema),
    meta: z.object({
        total: z.number(),
        cached: z.boolean(),
        source: z.enum(['redis', 'database', 'igdb', 'itad', 'local']).optional(),
    }),
});

export type GameSearchResponseDto = z.infer<typeof GameSearchResponseSchema>;

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
    /** ROK-986: Filter by IGDB enrichment status */
    enrichmentStatus: z.enum(['pending', 'failed', 'not_found']).optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
});

export type AdminGameListQueryDto = z.infer<typeof AdminGameListQuerySchema>;

/** Admin game list response */
export const AdminGameListResponseSchema = z.object({
    data: z.array(z.object({
        id: z.number(),
        igdbId: z.number().nullable(),
        name: z.string(),
        slug: z.string(),
        coverUrl: z.string().nullable(),
        cachedAt: z.string(),
        hidden: z.boolean(),
        banned: z.boolean(),
        /** ROK-986: IGDB enrichment status */
        igdbEnrichmentStatus: z.enum(['pending', 'enriched', 'failed', 'not_found', 'not_applicable']).nullable().optional(),
        /** ROK-986: Number of failed IGDB enrichment attempts */
        igdbEnrichmentRetryCount: z.number().optional(),
        /** ROK-986: Steam app ID for admin visibility */
        steamAppId: z.number().nullable().optional(),
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
    /** Source of the interest: manual, steam, discord, or poll (ROK-444, ROK-1031) */
    source: z.enum(['manual', 'steam', 'discord', 'poll']).optional(),
    /** ROK-745: Steam owners — first N players who own this game on Steam */
    owners: z.array(InterestPlayerPreviewSchema).optional(),
    /** ROK-745: Total count of Steam owners */
    ownerCount: z.number().optional(),
    /** ROK-774: Steam wishlisters — first N players who wishlisted this game */
    wishlisters: z.array(InterestPlayerPreviewSchema).optional(),
    /** ROK-418: Number of users who wishlisted this game via Steam */
    wishlistedCount: z.number().optional(),
    /** ROK-418: Whether the current user has wishlisted this game on Steam */
    wishlistedByMe: z.boolean().optional(),
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
    igdbId: z.number().nullable(),
    name: z.string(),
    slug: z.string(),
    coverUrl: z.string().nullable(),
    /** ROK-805: Steam playtime in seconds, if available */
    playtimeSeconds: z.number().nullable(),
});

export type UserHeartedGameDto = z.infer<typeof UserHeartedGameSchema>;

/** Pagination metadata shared across paginated endpoints */
export const PaginationMetaSchema = z.object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    hasMore: z.boolean(),
});

export type PaginationMetaDto = z.infer<typeof PaginationMetaSchema>;

/** Response for user hearted games endpoint (ROK-282, ROK-754: paginated) */
export const UserHeartedGamesResponseSchema = z.object({
    data: z.array(UserHeartedGameSchema),
    meta: PaginationMetaSchema,
});

export type UserHeartedGamesResponseDto = z.infer<typeof UserHeartedGamesResponseSchema>;

// ============================================================
// ROK-754: Steam Library section on player profile
// ============================================================

/** A single game from the user's Steam library */
export const SteamLibraryEntrySchema = z.object({
    gameId: z.number(),
    gameName: z.string(),
    coverUrl: z.string().nullable(),
    slug: z.string(),
    /** Playtime in seconds (converted from Steam minutes) */
    playtimeSeconds: z.number(),
    /** Playtime in the last 2 weeks in seconds (null if unavailable) */
    playtime2weeksSeconds: z.number().nullable(),
});

export type SteamLibraryEntryDto = z.infer<typeof SteamLibraryEntrySchema>;

/** Response for GET /users/:id/steam-library */
export const SteamLibraryResponseSchema = z.object({
    data: z.array(SteamLibraryEntrySchema),
    meta: PaginationMetaSchema,
});

export type SteamLibraryResponseDto = z.infer<typeof SteamLibraryResponseSchema>;

// ============================================================
// ROK-443: Game Activity Display (Phase 2)
// ============================================================

/** Period filter for activity queries */
export const ActivityPeriodSchema = z.enum(['week', 'month', 'all']);
export type ActivityPeriod = z.infer<typeof ActivityPeriodSchema>;

/** A single game activity entry in a user's activity list */
export const GameActivityEntrySchema = z.object({
    gameId: z.number(),
    gameName: z.string(),
    coverUrl: z.string().nullable(),
    totalSeconds: z.number(),
    isMostPlayed: z.boolean(),
});

export type GameActivityEntryDto = z.infer<typeof GameActivityEntrySchema>;

/** Response for GET /users/:id/activity */
export const UserActivityResponseSchema = z.object({
    data: z.array(GameActivityEntrySchema),
    period: ActivityPeriodSchema,
});

export type UserActivityResponseDto = z.infer<typeof UserActivityResponseSchema>;

/** A top player entry for game activity */
export const GameTopPlayerSchema = z.object({
    userId: z.number(),
    username: z.string(),
    avatar: z.string().nullable(),
    customAvatarUrl: z.string().nullable(),
    discordId: z.string().nullable(),
    totalSeconds: z.number(),
});

export type GameTopPlayerDto = z.infer<typeof GameTopPlayerSchema>;

/** Response for GET /games/:id/activity */
export const GameActivityResponseSchema = z.object({
    topPlayers: z.array(GameTopPlayerSchema),
    totalSeconds: z.number(),
    period: ActivityPeriodSchema,
});

export type GameActivityResponseDto = z.infer<typeof GameActivityResponseSchema>;

/** A player currently playing a game */
export const NowPlayingPlayerSchema = z.object({
    userId: z.number(),
    username: z.string(),
    avatar: z.string().nullable(),
    customAvatarUrl: z.string().nullable(),
    discordId: z.string().nullable(),
});

export type NowPlayingPlayerDto = z.infer<typeof NowPlayingPlayerSchema>;

/** Response for GET /games/:id/now-playing */
export const GameNowPlayingResponseSchema = z.object({
    players: z.array(NowPlayingPlayerSchema),
    count: z.number(),
});

export type GameNowPlayingResponseDto = z.infer<typeof GameNowPlayingResponseSchema>;
