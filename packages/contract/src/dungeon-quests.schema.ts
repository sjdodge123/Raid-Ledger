import { z } from 'zod';

/**
 * ROK-245: Dungeon quest API schemas.
 */

/** Single dungeon quest DTO */
export const DungeonQuestDtoSchema = z.object({
    questId: z.number(),
    dungeonInstanceId: z.number().nullable(),
    name: z.string(),
    questLevel: z.number().nullable(),
    requiredLevel: z.number().nullable(),
    expansion: z.enum(['classic', 'tbc', 'wotlk', 'cata']),
    questGiverNpc: z.string().nullable(),
    questGiverZone: z.string().nullable(),
    prevQuestId: z.number().nullable(),
    nextQuestId: z.number().nullable(),
    rewardsJson: z.array(z.number()).nullable(),
    objectives: z.string().nullable(),
    classRestriction: z.array(z.string()).nullable(),
    raceRestriction: z.array(z.string()).nullable(),
    startsInsideDungeon: z.boolean(),
    sharable: z.boolean(),
    rewardXp: z.number().nullable(),
    rewardGold: z.number().nullable(),
    rewardType: z.string().nullable(),
});

export type DungeonQuestDto = z.infer<typeof DungeonQuestDtoSchema>;

/** Response schema for GET /plugins/wow-classic/instances/:id/quests */
export const DungeonQuestsResponseSchema = z.array(DungeonQuestDtoSchema);
export type DungeonQuestsResponse = z.infer<typeof DungeonQuestsResponseSchema>;

/** Quest chain response schema */
export const QuestChainResponseSchema = z.array(DungeonQuestDtoSchema);
export type QuestChainResponse = z.infer<typeof QuestChainResponseSchema>;

/**
 * ROK-246: Enriched quest schemas with reward item details and prerequisite chains.
 */

/** Single enriched reward item with details looked up from boss loot data */
export const EnrichedQuestRewardSchema = z.object({
    itemId: z.number(),
    itemName: z.string(),
    quality: z.string(),
    slot: z.string().nullable(),
    itemLevel: z.number().nullable(),
    iconUrl: z.string().nullable(),
});

export type EnrichedQuestReward = z.infer<typeof EnrichedQuestRewardSchema>;

/** Enriched quest DTO — base quest + resolved reward details + prerequisite chain */
export const EnrichedDungeonQuestDtoSchema = DungeonQuestDtoSchema.extend({
    rewards: z.array(EnrichedQuestRewardSchema).nullable(),
    prerequisiteChain: z.array(DungeonQuestDtoSchema).nullable(),
});

export type EnrichedDungeonQuestDto = z.infer<typeof EnrichedDungeonQuestDtoSchema>;

/** Response schema for enriched quests endpoint */
export const EnrichedDungeonQuestsResponseSchema = z.array(EnrichedDungeonQuestDtoSchema);
export type EnrichedDungeonQuestsResponse = z.infer<typeof EnrichedDungeonQuestsResponseSchema>;
