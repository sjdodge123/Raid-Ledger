/**
 * ROK-2143 — MSW fixtures for the admin WoW Forever quest import panel. The
 * default GET (`foreverQuestImportHandlers`) answers `idle` (never ran), so admin Forever section specs that
 * never look at the panel are unaffected. Specs `server.use()` their own
 * `foreverQuestImportGetHandler` / `foreverQuestImportPostHandler`.
 */
import { http, HttpResponse } from 'msw';
import type { ForeverQuestImportReport } from '@raid-ledger/contract';

export const FOREVER_QUEST_IMPORT_URL = 'http://localhost:3000/admin/plugins/blizzard/forever-quests/import';

export function buildQuestImportReport(over: Partial<ForeverQuestImportReport> = {}): ForeverQuestImportReport {
    return {
        status: 'idle', runId: null, startedAt: null, finishedAt: null,
        counts: { requests: 0, areasImported: 0, questsListed: 0, questsFetched: 0, prerequisitesFetched: 0, upserted: 0 },
        mismatchedAreas: [], unlistedQuests: [], requirementKeyPaths: [], staleQuestIds: [],
        itemLevelProbe: null, errors: [], ...over,
    };
}

/** A finished run: 19 dungeons, 120 quests + 14 prerequisites, all saved. */
export function buildSucceededReport(over: Partial<ForeverQuestImportReport> = {}): ForeverQuestImportReport {
    return buildQuestImportReport({
        status: 'succeeded', runId: 'run-1',
        startedAt: '2026-11-09T10:00:00.000Z', finishedAt: '2026-11-09T10:02:30.000Z',
        counts: { requests: 160, areasImported: 19, questsListed: 120, questsFetched: 120, prerequisitesFetched: 14, upserted: 134 },
        ...over,
    });
}

/** GET answers each report in turn, then repeats the last (a poll sequence). */
export function foreverQuestImportGetHandler(...reports: ForeverQuestImportReport[]) {
    let call = 0;
    return http.get(FOREVER_QUEST_IMPORT_URL, () => {
        const body = reports[Math.min(call, reports.length - 1)] ?? buildQuestImportReport();
        call += 1;
        return HttpResponse.json(body);
    });
}

/** POST answers 202 with `report`, or the given error status + server message. */
export function foreverQuestImportPostHandler(
    result: ForeverQuestImportReport | { status: 403 | 409; message: string; code?: string },
) {
    return http.post(FOREVER_QUEST_IMPORT_URL, () => ('message' in result
        ? HttpResponse.json({ statusCode: result.status, message: result.message, ...(result.code ? { code: result.code } : {}) }, { status: result.status })
        : HttpResponse.json(result, { status: 202 })));
}

/** Default handlers for specs that render the admin Forever section without looking at this panel. */
export const foreverQuestImportHandlers = [foreverQuestImportGetHandler(buildQuestImportReport())];
