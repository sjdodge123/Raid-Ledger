import { z } from 'zod';

// ==========================================
// Game Registry Schemas
// ==========================================

/**
 * Game Registry DTO - Represents a supported game with its configuration.
 */
export const GameRegistrySchema = z.object({
    id: z.string().uuid(),
    slug: z.string().min(1).max(50),
    name: z.string().min(1).max(100),
    iconUrl: z.string().url().nullable(),
    colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
    hasRoles: z.boolean(),
    hasSpecs: z.boolean(),
    maxCharactersPerUser: z.number().int().positive(),
    createdAt: z.string().datetime(),
});

export type GameRegistryDto = z.infer<typeof GameRegistrySchema>;

/**
 * Event Type DTO - Game-specific event type template.
 */
export const EventTypeSchema = z.object({
    id: z.string().uuid(),
    gameId: z.string().uuid(),
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
 * Response for GET /game-registry
 */
export const GameRegistryListResponseSchema = z.object({
    data: z.array(GameRegistrySchema),
    meta: z.object({
        total: z.number(),
    }),
});

export type GameRegistryListResponseDto = z.infer<typeof GameRegistryListResponseSchema>;

/**
 * Response for GET /game-registry/:id
 */
export const GameRegistryDetailResponseSchema = GameRegistrySchema.extend({
    eventTypes: z.array(EventTypeSchema),
});

export type GameRegistryDetailResponseDto = z.infer<typeof GameRegistryDetailResponseSchema>;

/**
 * Response for GET /game-registry/:id/event-types
 */
export const EventTypesResponseSchema = z.object({
    data: z.array(EventTypeSchema),
    meta: z.object({
        total: z.number(),
        gameId: z.string().uuid(),
        gameName: z.string(),
    }),
});

export type EventTypesResponseDto = z.infer<typeof EventTypesResponseSchema>;
