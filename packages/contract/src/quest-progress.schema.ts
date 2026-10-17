import { z } from 'zod';

/**
 * ROK-246: Quest progress tracking schemas.
 * Per-event, per-player quest pickup/completion status.
 */

/** ROK-1748: where a progress value came from (LedgerLink snapshot or a manual tick). */
export const QuestProgressSourceSchema = z.enum(['addon', 'manual']);
export type QuestProgressSource = z.infer<typeof QuestProgressSourceSchema>;

/** Single quest progress entry (`id: 0` = synthetic addon row, ROK-1748 D9) */
export const QuestProgressDtoSchema = z.object({
    id: z.number(),
    eventId: z.number(),
    userId: z.number(),
    username: z.string(),
    questId: z.number(),
    pickedUp: z.boolean(),
    completed: z.boolean(),
    source: QuestProgressSourceSchema.optional(),
    asOf: z.string().datetime().optional(),
    characterId: z.string().uuid().nullable().optional(),
});

export type QuestProgressDto = z.infer<typeof QuestProgressDtoSchema>;

/** Response: all progress entries for an event */
export const QuestProgressResponseSchema = z.array(QuestProgressDtoSchema);
export type QuestProgressResponse = z.infer<typeof QuestProgressResponseSchema>;

/** Body for updating quest progress */
export const UpdateQuestProgressBodySchema = z.object({
    questId: z.number(),
    pickedUp: z.boolean().optional(),
    completed: z.boolean().optional(),
});

export type UpdateQuestProgressBody = z.infer<typeof UpdateQuestProgressBodySchema>;

/** Sharable quest coverage — which quests are covered by whom */
export const QuestCoverageEntrySchema = z.object({
    questId: z.number(),
    coveredBy: z.array(z.object({
        userId: z.number(),
        username: z.string(),
        source: QuestProgressSourceSchema.optional(),
        asOf: z.string().datetime().optional(),
    })),
});

export type QuestCoverageEntry = z.infer<typeof QuestCoverageEntrySchema>;

export const QuestCoverageResponseSchema = z.array(QuestCoverageEntrySchema);
export type QuestCoverageResponse = z.infer<typeof QuestCoverageResponseSchema>;

/** ROK-1748 D11/D12: one step of a quest's pre-req chain for the viewer. */
export const QuestPrereqStepSchema = z.object({
    questId: z.number().int(),
    name: z.string(),
    done: z.boolean(),
    source: QuestProgressSourceSchema.nullable(),
});
export type QuestPrereqStep = z.infer<typeof QuestPrereqStepSchema>;

/** ROK-1748 D12: the viewer's chain state for one event quest. */
export const QuestPrereqStateSchema = z.object({
    questId: z.number().int(),
    steps: z.array(QuestPrereqStepSchema),
    neededCount: z.number().int(),
    completed: z.boolean(),
    completedSource: QuestProgressSourceSchema.nullable(),
});
export type QuestPrereqState = z.infer<typeof QuestPrereqStateSchema>;

/** ROK-1748 D11: `GET events/:eventId/quest-prereqs/me` — null without a Forever character. */
export const EventQuestPrereqsResponseSchema = z.object({
    characterId: z.string().uuid(),
    asOf: z.string().datetime().nullable(),
    quests: z.array(QuestPrereqStateSchema),
    neededTotal: z.number().int(),
}).nullable();
export type EventQuestPrereqsResponse = z.infer<typeof EventQuestPrereqsResponseSchema>;
