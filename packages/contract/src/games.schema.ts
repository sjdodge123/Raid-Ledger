import { z } from 'zod';

// Query parameters for game search
export const GameSearchQuerySchema = z.object({
    q: z.string().min(1).max(100),
});

export type GameSearchQueryDto = z.infer<typeof GameSearchQuerySchema>;

// Individual game from IGDB (cached locally)
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
