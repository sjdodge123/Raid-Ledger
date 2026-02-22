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
});

export type DungeonQuestDto = z.infer<typeof DungeonQuestDtoSchema>;

/** Response schema for GET /plugins/wow-classic/instances/:id/quests */
export const DungeonQuestsResponseSchema = z.array(DungeonQuestDtoSchema);
export type DungeonQuestsResponse = z.infer<typeof DungeonQuestsResponseSchema>;

/** Quest chain response schema */
export const QuestChainResponseSchema = z.array(DungeonQuestDtoSchema);
export type QuestChainResponse = z.infer<typeof QuestChainResponseSchema>;
