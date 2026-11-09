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

/** An `{ id, name }` area from Blizzard's quest area list. */
export const ForeverQuestImportAreaRefSchema = z.object({
    id: z.number(),
    name: z.string(),
});

/**
 * One of our quests for a skipped dungeon, fetched so the report shows the
 * area Blizzard files it under (ROK-2143 L6: evidence for the area map).
 */
export const ForeverQuestImportSampleQuestSchema = z.object({
    questId: z.number(),
    httpStatus: z.number(),
    areaId: z.number().nullable(),
    areaName: z.string().nullable(),
});

/**
 * A mapped dungeon whose Blizzard quest area was not listed or whose name did
 * not match (the dungeon was skipped). `nameMatches` (areas in the list named
 * like the dungeon) and `sampleQuest` are optional additions (v1, additive).
 */
export const ForeverQuestImportMismatchedAreaSchema = z.object({
    instanceId: z.number(),
    dungeon: z.string(),
    areaId: z.number(),
    actualName: z.string().nullable(),
    nameMatches: z.array(ForeverQuestImportAreaRefSchema).optional(),
    sampleQuest: ForeverQuestImportSampleQuestSchema.optional(),
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
export type ForeverQuestImportAreaRef = z.infer<
    typeof ForeverQuestImportAreaRefSchema
>;
export type ForeverQuestImportSampleQuest = z.infer<
    typeof ForeverQuestImportSampleQuestSchema
>;
export type ForeverQuestImportReport = z.infer<
    typeof ForeverQuestImportReportSchema
>;
