import { z } from 'zod';

/**
 * ROK-246: Quest progress tracking schemas.
 * Per-event, per-player quest pickup/completion status.
 */

/** Single quest progress entry */
export const QuestProgressDtoSchema = z.object({
    id: z.number(),
    eventId: z.number(),
    userId: z.number(),
    username: z.string(),
    questId: z.number(),
    pickedUp: z.boolean(),
    completed: z.boolean(),
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
    })),
});

export type QuestCoverageEntry = z.infer<typeof QuestCoverageEntrySchema>;

export const QuestCoverageResponseSchema = z.array(QuestCoverageEntrySchema);
export type QuestCoverageResponse = z.infer<typeof QuestCoverageResponseSchema>;
