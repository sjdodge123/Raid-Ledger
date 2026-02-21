import { z } from 'zod';

// ==========================================
// Character Role Enum
// ==========================================

export const CharacterRoleSchema = z.enum(['tank', 'healer', 'dps']);
export type CharacterRole = z.infer<typeof CharacterRoleSchema>;

// ==========================================
// Equipment Types (Character Detail Page)
// ==========================================

export const EquipmentItemSchema = z.object({
    slot: z.string(),
    name: z.string(),
    itemId: z.number().int(),
    quality: z.string(),
    itemLevel: z.number().int(),
    itemSubclass: z.string().nullable(),
    enchantments: z.array(z.object({
        displayString: z.string(),
        enchantmentId: z.number().int().optional(),
    })).optional(),
    sockets: z.array(z.object({
        socketType: z.string(),
        itemId: z.number().int().optional(),
    })).optional(),
    /** Stat values for fallback tooltip */
    stats: z.array(z.object({
        type: z.string(),
        name: z.string(),
        value: z.number(),
    })).optional(),
    /** Armor value */
    armor: z.number().int().optional(),
    /** Binding type: "ON_EQUIP" | "ON_ACQUIRE" etc. */
    binding: z.string().optional(),
    /** Required character level */
    requiredLevel: z.number().int().optional(),
    /** Weapon damage/speed info */
    weapon: z.object({
        damageMin: z.number(),
        damageMax: z.number(),
        attackSpeed: z.number(),
        dps: z.number(),
    }).optional(),
    /** Flavor text / item description */
    description: z.string().optional(),
    /** Set name if item is part of a set */
    setName: z.string().optional(),
    /** Item icon URL from Blizzard media API */
    iconUrl: z.string().optional(),
});

export type EquipmentItemDto = z.infer<typeof EquipmentItemSchema>;

export const CharacterEquipmentSchema = z.object({
    equippedItemLevel: z.number().int().nullable(),
    items: z.array(EquipmentItemSchema),
    syncedAt: z.string().datetime(),
});

export type CharacterEquipmentDto = z.infer<typeof CharacterEquipmentSchema>;

// ==========================================
// Character DTOs
// ==========================================

/**
 * Full character DTO for API responses.
 */
export const CharacterSchema = z.object({
    id: z.string().uuid(),
    userId: z.number().int(),
    /** ROK-400: games.id (integer) — was UUID referencing game_registry */
    gameId: z.number().int(),
    name: z.string().min(1).max(100),
    realm: z.string().max(100).nullable(),
    class: z.string().max(50).nullable(),
    spec: z.string().max(50).nullable(),
    role: CharacterRoleSchema.nullable(),
    roleOverride: CharacterRoleSchema.nullable(),
    effectiveRole: CharacterRoleSchema.nullable(),
    isMain: z.boolean(),
    itemLevel: z.number().int().nullable(),
    externalId: z.string().max(255).nullable(),
    avatarUrl: z.string().url().nullable(),
    renderUrl: z.string().nullable(),
    level: z.number().int().nullable(),
    race: z.string().max(50).nullable(),
    faction: z.enum(['alliance', 'horde']).nullable(),
    lastSyncedAt: z.string().datetime().nullable(),
    profileUrl: z.string().url().nullable(),
    region: z.string().max(10).nullable(),
    gameVariant: z.string().max(30).nullable(),
    equipment: CharacterEquipmentSchema.nullable(),
    talents: z.unknown().nullable(),
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
    /** ROK-400: games.id (integer) */
    gameId: z.number().int().positive(),
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
    roleOverride: CharacterRoleSchema.nullable().optional(),
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
    gameId: z.number().int(),
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

// ==========================================
// WoW Armory Import (ROK-234)
// ==========================================

/** WoW regions supported by the Blizzard API */
export const WowRegionSchema = z.enum(['us', 'eu', 'kr', 'tw']);
export type WowRegion = z.infer<typeof WowRegionSchema>;

/**
 * WoW game variant — determines which Blizzard API namespace to use.
 * - retail: live game (dynamic-{region} / profile-{region})
 * - classic_era: Classic Era/SoD (dynamic-classic1x-{region} / profile-classic1x-{region})
 * - classic: Classic progression / Cata (dynamic-classic-{region} / profile-classic-{region})
 * - classic_anniversary: TBC Anniversary realms (dynamic-classicann-{region} / profile-classicann-{region})
 */
export const WowGameVariantSchema = z.enum(['retail', 'classic_era', 'classic', 'classic_anniversary']);
export type WowGameVariant = z.infer<typeof WowGameVariantSchema>;

/**
 * Request body for POST /users/me/characters/import/wow
 */
export const ImportWowCharacterSchema = z.object({
    name: z.string().min(1).max(100),
    realm: z.string().min(1).max(100),
    region: WowRegionSchema,
    gameVariant: WowGameVariantSchema.optional().default('retail'),
    isMain: z.boolean().optional().default(false),
});

export type ImportWowCharacterDto = z.infer<typeof ImportWowCharacterSchema>;
export type ImportWowCharacterInput = z.input<typeof ImportWowCharacterSchema>;

/**
 * Request body for POST /users/me/characters/:id/refresh
 */
export const RefreshCharacterSchema = z.object({
    region: WowRegionSchema,
    gameVariant: WowGameVariantSchema.optional().default('retail'),
});

export type RefreshCharacterDto = z.infer<typeof RefreshCharacterSchema>;
/** Input type for frontend — gameVariant is optional (backend defaults to 'retail') */
export type RefreshCharacterInput = z.input<typeof RefreshCharacterSchema>;

// ==========================================
// WoW Realm List (ROK-234 UX refinements)
// ==========================================

export const WowRealmSchema = z.object({
    name: z.string(),
    slug: z.string(),
    id: z.number().int(),
});

export type WowRealmDto = z.infer<typeof WowRealmSchema>;

export const WowRealmListResponseSchema = z.object({
    data: z.array(WowRealmSchema),
});

export type WowRealmListResponseDto = z.infer<typeof WowRealmListResponseSchema>;

// ==========================================
// Blizzard Character Preview (ROK-234 UX refinements)
// ==========================================

export const BlizzardCharacterPreviewSchema = z.object({
    name: z.string(),
    realm: z.string(),
    class: z.string(),
    spec: z.string().nullable(),
    role: z.enum(['tank', 'healer', 'dps']).nullable(),
    level: z.number().int(),
    race: z.string(),
    faction: z.enum(['alliance', 'horde']),
    itemLevel: z.number().int().nullable(),
    avatarUrl: z.string().nullable(),
    profileUrl: z.string().nullable(),
});

export type BlizzardCharacterPreviewDto = z.infer<typeof BlizzardCharacterPreviewSchema>;
