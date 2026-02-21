import { z } from 'zod';

// ==========================================
// Game Config Schemas (ROK-400: unified from game_registry)
// ==========================================

/**
 * Game Config DTO - Represents a supported game with its configuration.
 * ROK-400: Now uses games.id (integer) instead of game_registry.id (uuid).
 */
export const GameRegistrySchema = z.object({
    id: z.number(),
    slug: z.string().min(1),
    name: z.string().min(1),
    shortName: z.string().max(30).nullable(),
    coverUrl: z.string().nullable(),
    colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
    hasRoles: z.boolean(),
    hasSpecs: z.boolean(),
    enabled: z.boolean(),
    maxCharactersPerUser: z.number().int().positive(),
});

export type GameRegistryDto = z.infer<typeof GameRegistrySchema>;

/**
 * Event Type DTO - Game-specific event type template.
 * ROK-400: gameId is now integer (games.id).
 */
export const EventTypeSchema = z.object({
    id: z.number(),
    gameId: z.number(),
    slug: z.string().min(1).max(50),
    name: z.string().min(1).max(100),
    defaultPlayerCap: z.number().int().positive().nullable(),
    defaultDurationMinutes: z.number().int().positive().nullable(),
    requiresComposition: z.boolean(),
    createdAt: z.string().datetime(),
});

export type EventTypeDto = z.infer<typeof EventTypeSchema>;

// ==========================================
// Response Schemas
// ==========================================

/**
 * Response for GET /games/configured (formerly GET /game-registry)
 */
export const GameRegistryListResponseSchema = z.object({
    data: z.array(GameRegistrySchema),
    meta: z.object({
        total: z.number(),
    }),
});

export type GameRegistryListResponseDto = z.infer<typeof GameRegistryListResponseSchema>;

/**
 * Response for GET /games/:id/config (formerly GET /game-registry/:id)
 */
export const GameRegistryDetailResponseSchema = GameRegistrySchema.extend({
    eventTypes: z.array(EventTypeSchema),
});

export type GameRegistryDetailResponseDto = z.infer<typeof GameRegistryDetailResponseSchema>;

/**
 * Response for GET /games/:id/event-types
 */
export const EventTypesResponseSchema = z.object({
    data: z.array(EventTypeSchema),
    meta: z.object({
        total: z.number(),
        gameId: z.number(),
        gameName: z.string(),
    }),
});

export type EventTypesResponseDto = z.infer<typeof EventTypesResponseSchema>;
