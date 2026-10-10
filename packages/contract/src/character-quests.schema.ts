import { z } from 'zod';

/**
 * ROK-1745: quest tracking section on the WoW: Forever character page.
 * Built from the addon snapshot's quest log + completed ids, intersected with
 * the known dungeon-quest table. The raw completed-id list never leaves the API.
 */

/** One objective line of an in-progress quest. */
export const CharacterQuestObjectiveSchema = z.object({
    text: z.string(),
    done: z.boolean(),
    have: z.number().int().nullable(),
    need: z.number().int().nullable(),
});
export type CharacterQuestObjective = z.infer<typeof CharacterQuestObjectiveSchema>;

/** One quest in the character's quest log. */
export const CharacterQuestLogEntrySchema = z.object({
    questId: z.number().int(),
    title: z.string().nullable(),
    objectives: z.array(CharacterQuestObjectiveSchema),
    dungeonInstanceId: z.number().int().nullable(),
});
export type CharacterQuestLogEntry = z.infer<typeof CharacterQuestLogEntrySchema>;

/** One step of a quest chain, marked done when the character completed it. */
export const CharacterQuestChainStepSchema = z.object({
    questId: z.number().int(),
    name: z.string(),
    done: z.boolean(),
});
export type CharacterQuestChainStep = z.infer<typeof CharacterQuestChainStepSchema>;

/** A completed known dungeon quest. `chain.length <= 1` means no chain to show. */
export const CharacterCompletedQuestSchema = z.object({
    questId: z.number().int(),
    name: z.string(),
    questLevel: z.number().int().nullable(),
    chain: z.array(CharacterQuestChainStepSchema),
});
export type CharacterCompletedQuest = z.infer<typeof CharacterCompletedQuestSchema>;

/** Completed known quests of one dungeon instance. */
export const CharacterQuestInstanceGroupSchema = z.object({
    dungeonInstanceId: z.number().int(),
    instanceName: z.string(),
    completed: z.array(CharacterCompletedQuestSchema),
    knownCount: z.number().int(),
});
export type CharacterQuestInstanceGroup = z.infer<typeof CharacterQuestInstanceGroupSchema>;

/** GET /plugins/wow/characters/:id/quests body (when shown). */
export const CharacterQuestsDtoSchema = z.object({
    source: z.literal('addon'),
    syncedAt: z.string().datetime(),
    inProgress: z.array(CharacterQuestLogEntrySchema),
    completedKnown: z.array(CharacterQuestInstanceGroupSchema),
    counts: z.object({
        completedKnown: z.number().int(),
        knownTotal: z.number().int(),
        completedTotal: z.number().int(),
        inProgress: z.number().int(),
    }),
});
export type CharacterQuestsDto = z.infer<typeof CharacterQuestsDtoSchema>;

/**
 * Envelope so the wire never relies on an empty body.
 * `quests: null` = section hidden (non-Forever, no snapshot, no quest data).
 */
export const CharacterQuestsResponseSchema = z.object({
    quests: CharacterQuestsDtoSchema.nullable(),
});
export type CharacterQuestsResponse = z.infer<typeof CharacterQuestsResponseSchema>;
