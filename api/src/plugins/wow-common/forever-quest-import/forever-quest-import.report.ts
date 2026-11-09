/**
 * ROK-2143: the Forever quest import's run report — persisted as JSON in the
 * `wow_forever_quest_import_status` setting and returned by
 * `GET /admin/plugins/blizzard/forever-quests/import`.
 */
import type { ForeverQuestImportReport } from '@raid-ledger/contract';
import { FOREVER_QUEST_IMPORT_OFF_MESSAGE } from './forever-quest-import-switch';

/** Pause between Blizzard requests (same as the ROK-2124 auto-link job). */
export const FOREVER_QUEST_IMPORT_SPACING_MS = 500;
/** Prerequisite chain depth cap (listed quests are depth 0). */
export const FOREVER_QUEST_IMPORT_MAX_DEPTH = 10;
/** The quest data is identical in us/eu/kr/tw (probe 2026-11-08). */
export const FOREVER_QUEST_IMPORT_REGION = 'us';
/** A `running` marker older than this is a crashed run, not a live one. */
export const FOREVER_QUEST_IMPORT_STALE_RUNNING_MS = 60 * 60 * 1000;
/** Per-request Blizzard timeout: a hung socket fails the run instead of pinning it. */
export const FOREVER_QUEST_IMPORT_FETCH_TIMEOUT_MS = 15_000;
/** Error line on a run the server stopped mid-way (restart, deploy, crash). */
export const FOREVER_QUEST_IMPORT_INTERRUPTED_MESSAGE =
  'Interrupted (server restarted) — run the import again';
/** Most error lines kept in a report. */
export const FOREVER_QUEST_IMPORT_MAX_ERRORS = 50;
/** Sentry `context` tag for a failed run. */
export const FOREVER_QUEST_IMPORT_SENTRY_CONTEXT = 'wow-forever-quest-import';

/** The report shape lives in the contract (shared with the admin web panel). */
export {
  ForeverQuestImportCountsSchema,
  ForeverQuestImportReportSchema,
} from '@raid-ledger/contract';
export type {
  ForeverQuestImportCounts,
  ForeverQuestImportReport,
} from '@raid-ledger/contract';

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

/** True for the abort the kill switch throws (the operator's stop). */
export function isQuestImportOff(e: unknown): boolean {
  return (
    e instanceof QuestImportAbort &&
    e.message === FOREVER_QUEST_IMPORT_OFF_MESSAGE
  );
}

/** Append one error line, capped at {@link FOREVER_QUEST_IMPORT_MAX_ERRORS}. */
export function pushQuestImportError(
  report: ForeverQuestImportReport,
  message: string,
): void {
  if (report.errors.length < FOREVER_QUEST_IMPORT_MAX_ERRORS) {
    report.errors.push(message);
  }
}

/** A stored `running` report whose run no longer exists, as `failed`. */
export function markQuestImportInterrupted(
  report: ForeverQuestImportReport,
  now: Date,
): ForeverQuestImportReport {
  const out: ForeverQuestImportReport = {
    ...report,
    status: 'failed',
    finishedAt: now.toISOString(),
    errors: [...report.errors],
  };
  pushQuestImportError(out, FOREVER_QUEST_IMPORT_INTERRUPTED_MESSAGE);
  return out;
}
