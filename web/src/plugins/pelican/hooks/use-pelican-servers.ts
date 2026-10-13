/**
 * Pelican admin servers API (ROK-1094): `GET/PATCH /admin/plugins/pelican/servers`
 * and `POST /admin/plugins/pelican/sync` (ROK-1772). Responses are parsed with the
 * strict contract schemas, so a leaked panel uuid fails here too.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    PelicanServerListResponseSchema,
    PelicanServerRowSchema,
    PelicanSyncResultSchema,
    type PelicanServerRowDto,
    type PelicanServerUpdate,
    type PelicanSyncResult,
} from '@raid-ledger/contract';
import { getAuthToken } from '../../../hooks/use-auth';
import { adminFetch } from '../../../hooks/admin/admin-fetch';
import { applyServerPatch } from '../slots/pelican-servers.helpers';

export const PELICAN_SERVERS_PATH = '/admin/plugins/pelican/servers';
export const PELICAN_SYNC_PATH = '/admin/plugins/pelican/sync';
export const PELICAN_SERVERS_KEY = ['admin', 'plugins', 'pelican', 'servers'] as const;

export function usePelicanServers() {
    return useQuery<PelicanServerRowDto[]>({
        queryKey: [...PELICAN_SERVERS_KEY],
        queryFn: async () => PelicanServerListResponseSchema.parse(
            await adminFetch(PELICAN_SERVERS_PATH, undefined, 'Failed to load Pelican servers')).data,
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });
}

/** `patch` carries ONLY the changed field; `gameName` is for the optimistic row. */
export interface ServerUpdateVars { id: number; patch: PelicanServerUpdate; gameName?: string | null | undefined }
type Rollback = { previous: PelicanServerRowDto[] | undefined };

/** Optimistic: the cache shows the edit at once, and is restored if the PATCH fails. */
export function useUpdatePelicanServer() {
    const qc = useQueryClient();
    const key = [...PELICAN_SERVERS_KEY];
    return useMutation<PelicanServerRowDto, Error, ServerUpdateVars, Rollback>({
        mutationFn: async ({ id, patch }) => PelicanServerRowSchema.parse(await adminFetch(`${PELICAN_SERVERS_PATH}/${id}`, {
            method: 'PATCH', body: JSON.stringify(patch),
        }, 'Failed to update the server')),
        onMutate: async ({ id, patch, gameName }) => {
            await qc.cancelQueries({ queryKey: key });
            const previous = qc.getQueryData<PelicanServerRowDto[]>(key);
            qc.setQueryData<PelicanServerRowDto[]>(key, (rows) =>
                rows?.map((r) => (r.id === id ? applyServerPatch(r, patch, gameName) : r)));
            return { previous };
        },
        onError: (_err, _vars, ctx) => { if (ctx) qc.setQueryData(key, ctx.previous); },
        onSuccess: (row) => {
            qc.setQueryData<PelicanServerRowDto[]>(key, (rows) => rows?.map((r) => (r.id === row.id ? row : r)));
        },
    });
}

/** Always 200 — the outcome is data. Refreshes the list either way. */
export function usePelicanSyncNow() {
    const qc = useQueryClient();
    return useMutation<PelicanSyncResult, Error>({
        mutationFn: async () => PelicanSyncResultSchema.parse(
            await adminFetch(PELICAN_SYNC_PATH, { method: 'POST' }, 'Failed to sync Pelican servers')),
        onSettled: () => qc.invalidateQueries({ queryKey: [...PELICAN_SERVERS_KEY] }),
    });
}
