/**
 * ROK-1428 (L7) — TanStack Query hooks for the channel-lifecycle admin page:
 * settings, activity preview, suppressions, reconcile, Recreate and the
 * binding pin. Routes: `/admin/discord/lifecycle/*` (+ the existing bindings
 * PATCH and the ephemeral-voice category list — no new category route).
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type {
    ChannelBindingDto, ChannelLifecycleSettingsDto, DiscordCategorySummaryDto, GameLifecycleActivityListDto,
    LifecycleSuppressionListDto, ReconcileResultDto, UpdateChannelLifecycleSettingsDto,
} from '@raid-ledger/contract';
import { fetchApi } from '../../lib/api-client';

const BASE = '/admin/discord/lifecycle';
export const LIFECYCLE_KEY = ['admin', 'discord', 'lifecycle'] as const;
const BINDINGS_KEY = ['admin', 'discord', 'bindings'];
/** The activity preview — the bindings page invalidates it after a pin / edit / delete. */
export const LIFECYCLE_ACTIVITY_KEY = [...LIFECYCLE_KEY, 'activity'] as const;
/** The global 5-minute `staleTime` would show a stale Pin/Unpin label; always refetch on mount. */
const LIVE = { staleTime: 0 } as const;

/** Lifecycle settings (GET settings). */
export function useLifecycleSettings(): UseQueryResult<ChannelLifecycleSettingsDto> {
    return useQuery({ queryKey: [...LIFECYCLE_KEY, 'settings'], queryFn: () => fetchApi<ChannelLifecycleSettingsDto>(`${BASE}/settings`) });
}

/** Per-game activity + planned action (GET activity). */
export function useLifecycleActivity(): UseQueryResult<GameLifecycleActivityListDto> {
    return useQuery({ queryKey: LIFECYCLE_ACTIVITY_KEY, queryFn: () => fetchApi<GameLifecycleActivityListDto>(`${BASE}/activity`), ...LIVE });
}

/** Games the reconciler will not recreate (GET suppressions). */
export function useLifecycleSuppressions(): UseQueryResult<LifecycleSuppressionListDto> {
    return useQuery({ queryKey: [...LIFECYCLE_KEY, 'suppressions'], queryFn: () => fetchApi<LifecycleSuppressionListDto>(`${BASE}/suppressions`), ...LIVE });
}

/** Discord categories the bot can see (shared with ephemeral voice). */
export function useLifecycleCategories(): UseQueryResult<DiscordCategorySummaryDto[]> {
    return useQuery({
        queryKey: [...LIFECYCLE_KEY, 'categories'],
        queryFn: () => fetchApi<DiscordCategorySummaryDto[]>('/admin/settings/discord-bot/ephemeral-voice/categories'),
    });
}

/** Whether the Discord bot is online (the enable switch needs it). */
export function useLifecycleBotOnline(): { online: boolean; loading: boolean } {
    const q = useQuery({
        queryKey: [...LIFECYCLE_KEY, 'bot'],
        queryFn: () => fetchApi<{ connected?: boolean }>('/admin/settings/discord-bot'),
    });
    return { online: q.data?.connected === true, loading: q.isPending };
}

/** Refetch settings, activity and suppressions — not the bot / categories queries. */
function useInvalidateLifecycle(): () => Promise<void> {
    const qc = useQueryClient();
    return () => Promise.all(['settings', 'activity', 'suppressions'].map((k) =>
        qc.invalidateQueries({ queryKey: [...LIFECYCLE_KEY, k] }))).then(() => undefined);
}

/** PATCH settings; the server resolves categories when `enabled` flips on. */
export function useUpdateLifecycleSettings(): UseMutationResult<ChannelLifecycleSettingsDto, Error, UpdateChannelLifecycleSettingsDto> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (dto) => fetchApi<ChannelLifecycleSettingsDto>(`${BASE}/settings`, { method: 'PATCH', body: JSON.stringify(dto) }),
        onSuccess: (data) => {
            qc.setQueryData([...LIFECYCLE_KEY, 'settings'], data);
            void qc.invalidateQueries({ queryKey: [...LIFECYCLE_KEY, 'activity'] });
        },
    });
}

/** POST reconcile — `dryRun` plans only; a real run refreshes everything. */
export function useReconcile(): UseMutationResult<ReconcileResultDto, Error, boolean> {
    const invalidate = useInvalidateLifecycle();
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (dryRun) => fetchApi<ReconcileResultDto>(`${BASE}/reconcile?dryRun=${String(dryRun)}`, { method: 'POST' }),
        onSuccess: (result) => {
            if (result.dryRun) return;
            void invalidate();
            void qc.invalidateQueries({ queryKey: BINDINGS_KEY });
        },
    });
}

/** DELETE suppressions/:gameId — the next reconcile may create again. */
export function useRecreateGame(): UseMutationResult<void, Error, number> {
    const invalidate = useInvalidateLifecycle();
    return useMutation({
        mutationFn: (gameId) => fetchApi<void>(`${BASE}/suppressions/${gameId}`, { method: 'DELETE' }),
        onSuccess: () => invalidate(),
    });
}

/** PATCH bindings/:id {pinned} — refreshes the lifecycle preview and the bindings list. */
export function usePinBinding(): UseMutationResult<{ data: ChannelBindingDto }, Error, { id: string; pinned: boolean }> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, pinned }) => fetchApi<{ data: ChannelBindingDto }>(`/admin/discord/bindings/${id}`, { method: 'PATCH', body: JSON.stringify({ pinned }) }),
        onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: LIFECYCLE_ACTIVITY_KEY }), qc.invalidateQueries({ queryKey: BINDINGS_KEY })]).then(() => undefined),
    });
}
