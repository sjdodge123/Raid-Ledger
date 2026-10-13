/**
 * Calendar read-sync hooks (ROK-1595 L1): the per-connection calendar picker
 * list, the per-user read mode (PUT settings), read on/off + the picked
 * calendars (PATCH :id), and "Sync now". Writes are optimistic and revert on
 * error (D3); classify any error with `calendarReadErrorOf`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProviderCalendarSchema, type CalendarReadMode, type ProviderCalendar } from '@raid-ledger/contract';
import { getAuthToken } from './use-auth';
import { fetchApi, fetchWithAuth } from '../lib/api/fetch-api';
import {
    connectionReadChange, invalidateReadDependents, optimisticOverview, readModeChange, responseError,
    restoreOverview, retryAfterOf, type OverviewSnapshot, type ReadPatch, type SyncNowResult,
} from './calendar-read.helpers';
import { freshLastSynced, refreshWhenSynced, SYNC_LAND_DELAY_MS } from './calendar-sync-now.helpers';

const BASE = '/users/me/calendars';
const ProviderCalendarListSchema = ProviderCalendarSchema.array();

/**
 * Every read on/off and read-mode save carries this key, so the page-level
 * mode control and the per-card switches can stay disabled while any of them
 * is saving (`useIsMutating`) instead of racing each other (review r2).
 */
export const READ_SAVE_KEY = ['calendars', 'read-save'] as const;

export const providerCalendarsKey = (connectionId: number) => ['calendars', 'provider-calendars', connectionId] as const;

/** `GET /users/me/calendars/:id/calendars` — the picker list. 409 `read_scopes` without a read grant. */
export function useProviderCalendars(connectionId: number, enabled = true) {
    return useQuery<ProviderCalendar[]>({
        queryKey: providerCalendarsKey(connectionId),
        queryFn: () => fetchApi(`${BASE}/${connectionId}/calendars`, {}, ProviderCalendarListSchema),
        enabled: enabled && !!getAuthToken(),
        staleTime: 60_000,
        retry: false,
    });
}

/** `PUT /users/me/calendars/settings` → 204: the user's read mode (D1: per user). */
export function useUpdateReadSettings() {
    const qc = useQueryClient();
    return useMutation<void, Error, CalendarReadMode, OverviewSnapshot>({
        mutationKey: [...READ_SAVE_KEY],
        mutationFn: async (mode) => {
            await fetchApi<unknown>(`${BASE}/settings`, { method: 'PUT', body: JSON.stringify({ mode }) });
        },
        onMutate: (mode) => optimisticOverview(qc, (o) => readModeChange(o, mode)),
        onError: (_error, _mode, snapshot) => restoreOverview(qc, snapshot),
        onSettled: () => invalidateReadDependents(qc),
    });
}

/** `PATCH /users/me/calendars/:id` → 204 with a `read` body, optimistic on the overview. */
function useReadPatch<V extends { id: number }>(toPatch: (vars: V) => ReadPatch, mutationKey?: readonly string[]) {
    const qc = useQueryClient();
    return useMutation<void, Error, V, OverviewSnapshot>({
        ...(mutationKey ? { mutationKey: [...mutationKey] } : {}),
        mutationFn: async (vars) => {
            const body = JSON.stringify({ read: toPatch(vars) });
            await fetchApi<unknown>(`${BASE}/${vars.id}`, { method: 'PATCH', body });
        },
        onMutate: (vars) => optimisticOverview(qc, (o) => connectionReadChange(o, vars.id, toPatch(vars))),
        onError: (_error, _vars, snapshot) => restoreOverview(qc, snapshot),
        onSettled: () => invalidateReadDependents(qc),
    });
}

export interface SetReadEnabledInput { id: number; enabled: boolean }
export interface SetReadCalendarsInput { id: number; calendarIds: string[] }

/** Read on/off for one connection (F-2: both K2 switches off → `enabled:false`). */
export function useSetReadEnabled() {
    return useReadPatch<SetReadEnabledInput>(({ enabled }) => ({ enabled }), READ_SAVE_KEY);
}

/** The picker: which calendars to read (`[]` = primary only). */
export function useSetReadCalendars() {
    return useReadPatch<SetReadCalendarsInput>(({ calendarIds }) => ({ calendarIds }));
}

/**
 * `POST /users/me/calendars/:id/sync`: 202 → `queued`, 429 → `throttled`; 409s throw.
 * A 202 only queues the sync, so the follow-through waits for `lastSyncedAt`
 * (read fresh before the POST) to move before refetching the read dependents (`refreshWhenSynced`, capped).
 */
export function useSyncNow(landDelayMs = SYNC_LAND_DELAY_MS) {
    const qc = useQueryClient();
    return useMutation<SyncNowResult, Error, number, { before: string | null }>({
        onMutate: async (id) => ({ before: await freshLastSynced(qc, id) }),
        mutationFn: async (id) => {
            const res = await fetchWithAuth(`${BASE}/${id}/sync`, { method: 'POST' });
            if (res.status === 429) return { outcome: 'throttled', retryAfterSeconds: retryAfterOf(res) };
            if (!res.ok) throw await responseError(res);
            return { outcome: 'queued' };
        },
        onSuccess: (result, id, context) => {
            if (result.outcome === 'queued') void refreshWhenSynced(qc, id, context?.before ?? null, landDelayMs);
        },
    });
}
