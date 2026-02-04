import { z } from 'zod';

// ==========================================
// Character Role Enum
// ==========================================

export const CharacterRoleSchema = z.enum(['tank', 'healer', 'dps']);
export type CharacterRole = z.infer<typeof CharacterRoleSchema>;

// ==========================================
// Character DTOs
// ==========================================

/**
 * Full character DTO for API responses.
 */
export const CharacterSchema = z.object({
    id: z.string().uuid(),
    userId: z.number().int(),
    gameId: z.string().uuid(),
    name: z.string().min(1).max(100),
    realm: z.string().max(100).nullable(),
    class: z.string().max(50).nullable(),
    spec: z.string().max(50).nullable(),
    role: CharacterRoleSchema.nullable(),
    isMain: z.boolean(),
    itemLevel: z.number().int().nullable(),
    externalId: z.string().max(255).nullable(),
    avatarUrl: z.string().url().nullable(),
    displayOrder: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export type CharacterDto = z.infer<typeof CharacterSchema>;

// ==========================================
// Create Character
// ==========================================

/**
 * Request body for POST /users/me/characters
 */
export const CreateCharacterSchema = z.object({
    gameId: z.string().uuid(),
    name: z.string().min(1).max(100),
    realm: z.string().max(100).optional(),
    class: z.string().max(50).optional(),
    spec: z.string().max(50).optional(),
    role: CharacterRoleSchema.optional(),
    isMain: z.boolean().optional().default(false),
    itemLevel: z.number().int().positive().optional(),
    avatarUrl: z.string().url().optional(),
});

/** Type after Zod parsing (isMain has default applied) */
export type CreateCharacterDto = z.infer<typeof CreateCharacterSchema>;

/** Type for input before Zod parsing (isMain is optional) */
export type CreateCharacterInput = z.input<typeof CreateCharacterSchema>;

// ==========================================
// Update Character
// ==========================================

/**
 * Request body for PATCH /users/me/characters/:id
 */
export const UpdateCharacterSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    realm: z.string().max(100).nullable().optional(),
    class: z.string().max(50).nullable().optional(),
    spec: z.string().max(50).nullable().optional(),
    role: CharacterRoleSchema.nullable().optional(),
    itemLevel: z.number().int().positive().nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    displayOrder: z.number().int().optional(),
});

export type UpdateCharacterDto = z.infer<typeof UpdateCharacterSchema>;

// ==========================================
// Response Schemas
// ==========================================

/**
 * Response for GET /users/me/characters
 */
export const CharacterListResponseSchema = z.object({
    data: z.array(CharacterSchema),
    meta: z.object({
        total: z.number().int(),
    }),
});

export type CharacterListResponseDto = z.infer<typeof CharacterListResponseSchema>;

/**
 * Group characters by game for UI display.
 * Used by frontend to organize characters into collapsible game sections.
 */
export const CharactersByGameSchema = z.object({
    gameId: z.string().uuid(),
    gameName: z.string(),
    gameSlug: z.string(),
    characters: z.array(CharacterSchema),
});

export type CharactersByGameDto = z.infer<typeof CharactersByGameSchema>;

/**
 * Response for GET /users/me/characters?grouped=true
 */
export const CharactersGroupedResponseSchema = z.object({
    data: z.array(CharactersByGameSchema),
    meta: z.object({
        totalCharacters: z.number().int(),
        totalGames: z.number().int(),
    }),
});

export type CharactersGroupedResponseDto = z.infer<typeof CharactersGroupedResponseSchema>;
