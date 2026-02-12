import { z } from 'zod';
import { CharacterSchema } from './characters.schema.js';

// ==========================================
// User Role (ROK-272)
// ==========================================

/**
 * User roles in the system.
 * Hierarchy: admin > operator > member
 */
export const UserRoleSchema = z.enum(['member', 'operator', 'admin']);
export type UserRole = z.infer<typeof UserRoleSchema>;

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
    role: UserRoleSchema.optional(),
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
    discordId: z.string().nullable().optional(),
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

// ==========================================
// Role Update DTO (Admin-only)
// ==========================================

/**
 * Request to update a user's role. Admin-only.
 * Cannot promote to admin - only member <-> operator.
 */
export const UpdateUserRoleSchema = z.object({
    role: z.enum(['member', 'operator']),
});

export type UpdateUserRoleDto = z.infer<typeof UpdateUserRoleSchema>;

// ==========================================
// User Management List (Admin view)
// ==========================================

export const UserManagementSchema = z.object({
    id: z.number().int(),
    username: z.string(),
    avatar: z.string().nullable(),
    customAvatarUrl: z.string().nullable().optional(),
    role: UserRoleSchema,
    createdAt: z.string().datetime(),
});

export type UserManagementDto = z.infer<typeof UserManagementSchema>;

export const UserManagementListResponseSchema = z.object({
    data: z.array(UserManagementSchema),
    meta: z.object({
        total: z.number().int(),
        page: z.number().int(),
        limit: z.number().int(),
    }),
});

export type UserManagementListResponseDto = z.infer<typeof UserManagementListResponseSchema>;
