import { z } from 'zod';

// ============================================================
// WoW: Forever classic quest import — run report (ROK-2143)
// Returned by `POST` (202) and `GET /admin/plugins/blizzard/forever-quests/import`
// and persisted as JSON in the `wow_forever_quest_import_status` setting.
// ============================================================

/** A run's lifecycle; `idle` = the import has never run. */
export const ForeverQuestImportStatusSchema = z.enum([
    'idle',
    'running',
    'succeeded',
    'failed',
]);

export const ForeverQuestImportCountsSchema = z.object({
    requests: z.number(),
    areasImported: z.number(),
    questsListed: z.number(),
    questsFetched: z.number(),
    prerequisitesFetched: z.number(),
    upserted: z.number(),
});

/** A mapped dungeon whose Blizzard quest-area name did not match (the dungeon was skipped). */
export const ForeverQuestImportMismatchedAreaSchema = z.object({
    instanceId: z.number(),
    dungeon: z.string(),
    areaId: z.number(),
    actualName: z.string().nullable(),
});

export const ForeverQuestImportReportSchema = z.object({
    status: ForeverQuestImportStatusSchema,
    runId: z.string().nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    counts: ForeverQuestImportCountsSchema,
    mismatchedAreas: z.array(ForeverQuestImportMismatchedAreaSchema),
    /** Our quests a mapped area did not list, with the area Blizzard files them under. */
    unlistedQuests: z.array(
        z.object({ questId: z.number(), areaId: z.number().nullable() }),
    ),
    requirementKeyPaths: z.array(z.string()),
    staleQuestIds: z.array(z.number()),
    /** One classic 1.x item lookup for reward item level. */
    itemLevelProbe: z
        .object({
            itemId: z.number(),
            httpStatus: z.number(),
            itemLevel: z.number().nullable(),
        })
        .nullable(),
    errors: z.array(z.string()),
});

export type ForeverQuestImportStatus = z.infer<
    typeof ForeverQuestImportStatusSchema
>;
export type ForeverQuestImportCounts = z.infer<
    typeof ForeverQuestImportCountsSchema
>;
export type ForeverQuestImportMismatchedArea = z.infer<
    typeof ForeverQuestImportMismatchedAreaSchema
>;
export type ForeverQuestImportReport = z.infer<
    typeof ForeverQuestImportReportSchema
>;
