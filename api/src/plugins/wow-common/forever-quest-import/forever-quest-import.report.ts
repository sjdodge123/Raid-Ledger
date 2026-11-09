/**
 * ROK-2143: the Forever quest import's run report — persisted as JSON in the
 * `wow_forever_quest_import_status` setting and returned by
 * `GET /admin/plugins/blizzard/forever-quests/import`.
 */
import { z } from 'zod';

/** Pause between Blizzard requests (same as the ROK-2124 auto-link job). */
export const FOREVER_QUEST_IMPORT_SPACING_MS = 500;
/** Prerequisite chain depth cap (listed quests are depth 0). */
export const FOREVER_QUEST_IMPORT_MAX_DEPTH = 10;
/** The quest data is identical in us/eu/kr/tw (probe 2026-11-08). */
export const FOREVER_QUEST_IMPORT_REGION = 'us';
/** A `running` marker older than this is a crashed run, not a live one. */
export const FOREVER_QUEST_IMPORT_STALE_RUNNING_MS = 60 * 60 * 1000;
/** Most error lines kept in a report. */
export const FOREVER_QUEST_IMPORT_MAX_ERRORS = 50;
/** Sentry `context` tag for a failed run. */
export const FOREVER_QUEST_IMPORT_SENTRY_CONTEXT = 'wow-forever-quest-import';

export const ForeverQuestImportCountsSchema = z.object({
  requests: z.number(),
  areasImported: z.number(),
  questsListed: z.number(),
  questsFetched: z.number(),
  prerequisitesFetched: z.number(),
  upserted: z.number(),
});

export const ForeverQuestImportReportSchema = z.object({
  status: z.enum(['idle', 'running', 'succeeded', 'failed']),
  runId: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  counts: ForeverQuestImportCountsSchema,
  mismatchedAreas: z.array(
    z.object({
      instanceId: z.number(),
      dungeon: z.string(),
      areaId: z.number(),
      actualName: z.string().nullable(),
    }),
  ),
  /** Our quests a mapped area did not list, with the area Blizzard files them under. */
  unlistedQuests: z.array(
    z.object({ questId: z.number(), areaId: z.number().nullable() }),
  ),
  requirementKeyPaths: z.array(z.string()),
  staleQuestIds: z.array(z.number()),
  /** R8=B: one classic 1.x item lookup for reward item level. */
  itemLevelProbe: z
    .object({
      itemId: z.number(),
      httpStatus: z.number(),
      itemLevel: z.number().nullable(),
    })
    .nullable(),
  errors: z.array(z.string()),
});

export type ForeverQuestImportCounts = z.infer<
  typeof ForeverQuestImportCountsSchema
>;
export type ForeverQuestImportReport = z.infer<
  typeof ForeverQuestImportReportSchema
>;

/** A blank report; `idle` = never ran. */
export function emptyQuestImportReport(): ForeverQuestImportReport {
  return {
    status: 'idle',
    runId: null,
    startedAt: null,
    finishedAt: null,
    counts: {
      requests: 0,
      areasImported: 0,
      questsListed: 0,
      questsFetched: 0,
      prerequisitesFetched: 0,
      upserted: 0,
    },
    mismatchedAreas: [],
    unlistedQuests: [],
    requirementKeyPaths: [],
    staleQuestIds: [],
    itemLevelProbe: null,
    errors: [],
  };
}

/** 401/403/429/5xx end the run (no tight retry). */
export function isFatalQuestImportStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

/** Thrown to end a run as `failed`; what was written is kept. */
export class QuestImportAbort extends Error {}

/** Append one error line, capped at {@link FOREVER_QUEST_IMPORT_MAX_ERRORS}. */
export function pushQuestImportError(
  report: ForeverQuestImportReport,
  message: string,
): void {
  if (report.errors.length < FOREVER_QUEST_IMPORT_MAX_ERRORS) {
    report.errors.push(message);
  }
}
