import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { ForeverQuestImportReport } from '@raid-ledger/contract';
import { isConflictError } from '../../../lib/api/api-error';
import { fetchForeverQuestImport, startForeverQuestImport } from '../forever-quest-import-api';

/** TanStack Query key for the admin Forever quest import report (ROK-2143). */
export const FOREVER_QUEST_IMPORT_KEY = ['admin', 'blizzard', 'forever-quest-import'] as const;

/** How often the report is re-read while a run is in progress. */
export const FOREVER_QUEST_IMPORT_POLL_MS = 2_000;

/**
 * ROK-2162: how often the report is re-read while no run is in progress, so a
 * run the server starts by itself (first import, weekly) shows up while the
 * panel is open. TanStack pauses it while the tab is hidden.
 */
export const FOREVER_QUEST_IMPORT_IDLE_POLL_MS = 30_000;

/** Fast while the stored report says a run is in progress, slow otherwise. */
export function questImportRefetchInterval(report: ForeverQuestImportReport | undefined): number {
    return report?.status === 'running' ? FOREVER_QUEST_IMPORT_POLL_MS : FOREVER_QUEST_IMPORT_IDLE_POLL_MS;
}

/**
 * Admin Forever quest import (ROK-2143): the last-run report (polled) and a
 * Re-import mutation. A 409 (a run already in progress, e.g. one the server
 * started) re-reads the report so the panel catches up (ROK-2162).
 */
export function useForeverQuestImport(): {
    report: UseQueryResult<ForeverQuestImportReport>;
    start: UseMutationResult<ForeverQuestImportReport, Error, void>;
} {
    const queryClient = useQueryClient();
    const report = useQuery({
        queryKey: [...FOREVER_QUEST_IMPORT_KEY],
        queryFn: fetchForeverQuestImport,
        refetchInterval: (query) => questImportRefetchInterval(query.state.data),
        refetchOnWindowFocus: true,
    });
    const start = useMutation<ForeverQuestImportReport, Error, void>({
        mutationFn: startForeverQuestImport,
        onSuccess: (running) => queryClient.setQueryData([...FOREVER_QUEST_IMPORT_KEY], running),
        onError: (err) => {
            if (isConflictError(err)) void queryClient.invalidateQueries({ queryKey: [...FOREVER_QUEST_IMPORT_KEY] });
        },
    });
    return { report, start };
}
