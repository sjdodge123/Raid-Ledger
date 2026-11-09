import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { ForeverQuestImportReport } from '@raid-ledger/contract';
import { fetchForeverQuestImport, startForeverQuestImport } from '../forever-quest-import-api';

/** TanStack Query key for the admin Forever quest import report (ROK-2143). */
export const FOREVER_QUEST_IMPORT_KEY = ['admin', 'blizzard', 'forever-quest-import'] as const;

/** How often the report is re-read while a run is in progress. */
export const FOREVER_QUEST_IMPORT_POLL_MS = 2_000;

/** Poll only while the stored report says a run is in progress. */
export function questImportRefetchInterval(report: ForeverQuestImportReport | undefined): number | false {
    return report?.status === 'running' ? FOREVER_QUEST_IMPORT_POLL_MS : false;
}

/** Admin Forever quest import (ROK-2143): the last-run report (polled while running) and a Re-import mutation. */
export function useForeverQuestImport(): {
    report: UseQueryResult<ForeverQuestImportReport>;
    start: UseMutationResult<ForeverQuestImportReport, Error, void>;
} {
    const queryClient = useQueryClient();
    const report = useQuery({
        queryKey: [...FOREVER_QUEST_IMPORT_KEY],
        queryFn: fetchForeverQuestImport,
        refetchInterval: (query) => questImportRefetchInterval(query.state.data),
    });
    const start = useMutation<ForeverQuestImportReport, Error, void>({
        mutationFn: startForeverQuestImport,
        onSuccess: (running) => queryClient.setQueryData([...FOREVER_QUEST_IMPORT_KEY], running),
    });
    return { report, start };
}
