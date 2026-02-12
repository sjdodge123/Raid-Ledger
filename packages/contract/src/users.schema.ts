import { z } from 'zod';
import { CharacterSchema } from './characters.schema.js';

// ==========================================
// User Profile DTO (Public View)
// ==========================================

/**
 * Public user profile data returned by GET /users/:id/profile
 * This is the public-facing profile, intentionally limited to non-sensitive data.
 */
export const UserProfileSchema = z.object({
    id: z.number().int(),
    username: z.string(),
    avatar: z.string().nullable(),
    customAvatarUrl: z.string().nullable().optional(),
    createdAt: z.string().datetime(),
    characters: z.array(CharacterSchema),
});

export type UserProfileDto = z.infer<typeof UserProfileSchema>;

/**
 * Response wrapper for user profile endpoint
 */
export const UserProfileResponseSchema = z.object({
    data: UserProfileSchema,
});

export type UserProfileResponse = z.infer<typeof UserProfileResponseSchema>;

// ==========================================
// User Preview DTO (for lists, links)
// ==========================================

/**
 * Minimal user info for embedding in other responses (e.g., event creator).
 * Used by UserLink component.
 */
export const UserPreviewSchema = z.object({
    id: z.number().int(),
    username: z.string(),
    avatar: z.string().nullable(),
    customAvatarUrl: z.string().nullable().optional(),
});

export type UserPreviewDto = z.infer<typeof UserPreviewSchema>;

// ==========================================
// Players List Response (paginated)
// ==========================================

export const PlayersListResponseSchema = z.object({
    data: z.array(UserPreviewSchema),
    meta: z.object({
        total: z.number().int(),
        page: z.number().int(),
        limit: z.number().int(),
    }),
});

export type PlayersListResponseDto = z.infer<typeof PlayersListResponseSchema>;
