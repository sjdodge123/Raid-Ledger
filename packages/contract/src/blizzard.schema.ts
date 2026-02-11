import { z } from 'zod';

// ============================================================
// WoW Instance Schemas (Dungeon/Raid browsing)
// ============================================================

/** Basic WoW dungeon/raid instance info */
export const WowInstanceSchema = z.object({
    id: z.number().int(),
    name: z.string(),
    shortName: z.string().optional(),
    expansion: z.string(),
    minimumLevel: z.number().int().nullable().optional(),
    maximumLevel: z.number().int().nullable().optional(),
});

export type WowInstanceDto = z.infer<typeof WowInstanceSchema>;

/** Enriched instance with level requirements and player count */
export const WowInstanceDetailSchema = WowInstanceSchema.extend({
    minimumLevel: z.number().int().nullable(),
    maximumLevel: z.number().int().nullable().optional(),
    maxPlayers: z.number().int().nullable(),
    category: z.enum(['dungeon', 'raid']),
});

export type WowInstanceDetailDto = z.infer<typeof WowInstanceDetailSchema>;

/** Response for GET /blizzard/instances */
export const WowInstanceListResponseSchema = z.object({
    data: z.array(WowInstanceSchema),
});

export type WowInstanceListResponseDto = z.infer<typeof WowInstanceListResponseSchema>;
