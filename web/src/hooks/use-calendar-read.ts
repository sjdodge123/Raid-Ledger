/**
 * Calendar read-sync hooks (ROK-1595 L1): the per-connection calendar picker
 * list, the per-user read mode (PUT settings), read on/off + the picked
 * calendars (PATCH :id), and "Sync now". Writes are optimistic and revert on
 * error (D3); classify any error with `calendarReadErrorOf`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProviderCalendarSchema, type CalendarReadMode, type CalendarsOverview, type ProviderCalendar } from '@raid-ledger/contract';
import { getAuthToken } from './use-auth';
import { fetchApi, fetchWithAuth } from '../lib/api/fetch-api';
import { CALENDARS_OVERVIEW_KEY } from './use-calendar-sync';
import {
    invalidateReadDependents, optimisticOverview, patchConnectionRead, patchReadMode, responseError,
    restoreOverview, retryAfterOf, type OverviewSnapshot, type ReadPatch, type SyncNowResult,
} from './calendar-read.helpers';
import { lastSyncedOf, refreshWhenSynced, SYNC_LAND_DELAY_MS } from './calendar-sync-now.helpers';

const BASE = '/users/me/calendars';
const ProviderCalendarListSchema = ProviderCalendarSchema.array();

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
        mutationFn: async (mode) => {
            await fetchApi<unknown>(`${BASE}/settings`, { method: 'PUT', body: JSON.stringify({ mode }) });
        },
        onMutate: (mode) => optimisticOverview(qc, (o) => patchReadMode(o, mode)),
        onError: (_error, _mode, snapshot) => restoreOverview(qc, snapshot),
        onSettled: () => invalidateReadDependents(qc),
    });
}

/** `PATCH /users/me/calendars/:id` → 204 with a `read` body, optimistic on the overview. */
function useReadPatch<V extends { id: number }>(toPatch: (vars: V) => ReadPatch) {
    const qc = useQueryClient();
    return useMutation<void, Error, V, OverviewSnapshot>({
        mutationFn: async (vars) => {
            const body = JSON.stringify({ read: toPatch(vars) });
            await fetchApi<unknown>(`${BASE}/${vars.id}`, { method: 'PATCH', body });
        },
        onMutate: (vars) => optimisticOverview(qc, (o) => patchConnectionRead(o, vars.id, toPatch(vars))),
        onError: (_error, _vars, snapshot) => restoreOverview(qc, snapshot),
        onSettled: () => invalidateReadDependents(qc),
    });
}

export interface SetReadEnabledInput { id: number; enabled: boolean }
export interface SetReadCalendarsInput { id: number; calendarIds: string[] }

/** Read on/off for one connection (F-2: both K2 switches off → `enabled:false`). */
export function useSetReadEnabled() {
    return useReadPatch<SetReadEnabledInput>(({ enabled }) => ({ enabled }));
}

/** The picker: which calendars to read (`[]` = primary only). */
export function useSetReadCalendars() {
    return useReadPatch<SetReadCalendarsInput>(({ calendarIds }) => ({ calendarIds }));
}

/**
 * `POST /users/me/calendars/:id/sync`: 202 → `queued`, 429 → `throttled`; 409s throw.
 * A 202 only queues the sync, so the follow-through waits for `lastSyncedAt`
 * to move before refetching the read dependents (`refreshWhenSynced`, capped).
 */
export function useSyncNow(landDelayMs = SYNC_LAND_DELAY_MS) {
    const qc = useQueryClient();
    return useMutation<SyncNowResult, Error, number, { before: string | null }>({
        onMutate: (id) => ({ before: lastSyncedOf(qc.getQueryData<CalendarsOverview>([...CALENDARS_OVERVIEW_KEY]), id) }),
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
