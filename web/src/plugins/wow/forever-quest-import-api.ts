/**
 * ROK-2143: admin client for the WoW Forever classic quest import. Kept out of
 * `api-client.ts`, which is near the file-size limit.
 */
import { ForeverQuestImportReportSchema, type ForeverQuestImportReport } from '@raid-ledger/contract';
import { fetchApi } from '../../lib/api-client';

const FOREVER_QUEST_IMPORT_PATH = '/admin/plugins/blizzard/forever-quests/import';

/** Admin: the running import's report, else the last stored one (`idle` = never ran). */
export async function fetchForeverQuestImport(): Promise<ForeverQuestImportReport> {
    return fetchApi(FOREVER_QUEST_IMPORT_PATH, {}, ForeverQuestImportReportSchema);
}

/** Admin: start a background import (202 with the `running` report); 403 switch off, 409 unconfigured / running. */
export async function startForeverQuestImport(): Promise<ForeverQuestImportReport> {
    return fetchApi(FOREVER_QUEST_IMPORT_PATH, { method: 'POST' }, ForeverQuestImportReportSchema);
}
