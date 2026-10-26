/**
 * ROK-1941 — TanStack Query hooks for the hub's "Pictures" channel. Keys
 * extend `guildPageKey(guildId)` and end with the viewer scope (ROK-1314).
 * The backfill status polls every 5 s only while a run is `running`.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { guildPageKey } from '../api/use-guild';
import {
    deleteHubMediaChannel, fetchHubMediaBackfill, fetchHubMediaChannel, postHubMediaBackfill, putHubMediaChannel,
    runningJobOf, type HubMediaBackfillStatus, type HubMediaChannelState,
} from './hub-media-channel-api';

export const BACKFILL_POLL_MS = 5_000;

export function hubMediaChannelKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'media-channel'] as const;
}

export function hubMediaBackfillKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'media-channel-backfill'] as const;
}

export function useHubMediaChannel(guildId: number): UseQueryResult<HubMediaChannelState, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...hubMediaChannelKey(guildId), viewer],
        queryFn: () => fetchHubMediaChannel(guildId),
        enabled: guildId > 0,
        retry: false,
    });
}

export function useHubMediaBackfill(guildId: number): UseQueryResult<HubMediaBackfillStatus, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...hubMediaBackfillKey(guildId), viewer],
        queryFn: () => fetchHubMediaBackfill(guildId),
        enabled: guildId > 0,
        retry: false,
        refetchInterval: (query) => (query.state.data?.state === 'running' ? BACKFILL_POLL_MS : false),
        refetchIntervalInBackground: false,
    });
}

function useRefresh(guildId: number): () => Promise<unknown> {
    const queryClient = useQueryClient();
    return () => Promise.all([
        queryClient.invalidateQueries({ queryKey: hubMediaChannelKey(guildId) }),
        queryClient.invalidateQueries({ queryKey: hubMediaBackfillKey(guildId) }),
    ]);
}

export function useSetHubMediaChannel(guildId: number): UseMutationResult<HubMediaChannelState, Error, string> {
    const onSuccess = useRefresh(guildId);
    return useMutation<HubMediaChannelState, Error, string>({ mutationFn: (id) => putHubMediaChannel(guildId, id), onSuccess });
}

export function useClearHubMediaChannel(guildId: number): UseMutationResult<void, Error, void> {
    const onSuccess = useRefresh(guildId);
    return useMutation<void, Error, void>({ mutationFn: () => deleteHubMediaChannel(guildId), onSuccess });
}

/** Start a scan. A 409 still shows the run already in progress: its `job` seeds the status query. */
export function useStartHubMediaBackfill(guildId: number): UseMutationResult<HubMediaBackfillStatus, Error, void> {
    const queryClient = useQueryClient();
    const viewer = useViewerCacheScope();
    const seed = (status: HubMediaBackfillStatus): void => {
        queryClient.setQueryData([...hubMediaBackfillKey(guildId), viewer], status);
    };
    return useMutation<HubMediaBackfillStatus, Error, void>({
        mutationFn: () => postHubMediaBackfill(guildId),
        onSuccess: seed,
        onError: (error) => { const job = runningJobOf(error); if (job) seed(job); },
    });
}
