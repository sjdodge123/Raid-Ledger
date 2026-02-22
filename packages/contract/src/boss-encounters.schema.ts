import { z } from 'zod';

/**
 * ROK-244: Boss encounter and loot table API schemas.
 */

/** Single boss encounter DTO */
export const BossEncounterDtoSchema = z.object({
    id: z.number(),
    instanceId: z.number(),
    name: z.string(),
    order: z.number(),
    expansion: z.enum(['classic', 'tbc', 'wotlk', 'cata', 'sod']),
    sodModified: z.boolean(),
});

export type BossEncounterDto = z.infer<typeof BossEncounterDtoSchema>;

/** Single boss loot item DTO */
export const BossLootDtoSchema = z.object({
    id: z.number(),
    bossId: z.number(),
    itemId: z.number(),
    itemName: z.string(),
    slot: z.string().nullable(),
    quality: z.enum([
        'Poor',
        'Common',
        'Uncommon',
        'Rare',
        'Epic',
        'Legendary',
    ]),
    itemLevel: z.number().nullable(),
    dropRate: z.string().nullable(),
    expansion: z.enum(['classic', 'tbc', 'wotlk', 'cata', 'sod']),
    classRestrictions: z.array(z.string()).nullable(),
    iconUrl: z.string().nullable(),
});

export type BossLootDto = z.infer<typeof BossLootDtoSchema>;

/** Response schema for GET /plugins/wow-classic/instances/:id/bosses */
export const BossEncountersResponseSchema = z.array(BossEncounterDtoSchema);
export type BossEncountersResponse = z.infer<
    typeof BossEncountersResponseSchema
>;

/** Response schema for GET /plugins/wow-classic/bosses/:id/loot */
export const BossLootResponseSchema = z.array(BossLootDtoSchema);
export type BossLootResponse = z.infer<typeof BossLootResponseSchema>;
