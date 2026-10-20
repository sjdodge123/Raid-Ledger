/**
 * ROK-1853 — data hooks for the hub Materials tab. Every response depends on
 * the viewer (personal chests, D9: `private, no-store`), so each key carries
 * `useViewerCacheScope()`; claim / owner mutations invalidate the
 * `valheimMaterialsKeys.all` prefix (`use-valheim-claims.ts`).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
    ValheimContainerDetailSchema,
    ValheimContainerListResponseSchema,
    ValheimMaterialsResponseSchema,
    type ValheimContainerDetail,
    type ValheimContainerListResponse,
    type ValheimMaterialsResponse,
} from '@raid-ledger/contract';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { httpStatusOf } from '../../../lib/api/api-error';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';
import { VALHEIM_ARMORY_PATH } from '../lib/valheim-armory-api';

type Scope = number | 'anon';

export const valheimMaterialsKeys = {
    all: ['valheim', 'materials'] as const,
    totals: (scope: Scope, serverId: number, vehicles: boolean) =>
        [...valheimMaterialsKeys.all, scope, serverId, vehicles] as const,
    containers: (
        scope: Scope,
        serverId: number,
        vehicles: boolean,
        prefab: string | null,
    ) =>
        [
            ...valheimMaterialsKeys.all,
            scope,
            serverId,
            vehicles,
            'containers',
            prefab,
        ] as const,
    container: (
        scope: Scope,
        serverId: number,
        vehicles: boolean,
        key: string,
    ) =>
        [
            ...valheimMaterialsKeys.all,
            scope,
            serverId,
            vehicles,
            'container',
            key,
        ] as const,
};

/**
 * Keep the previous rows while a filter changes, but never across viewers:
 * the observer would otherwise show the last viewer's personal totals and
 * chest locations during impersonation until the new response lands (Codex
 * r2 P1). Key index 2 is the viewer scope. A fresh closure every render also
 * defeats TanStack's placeholder memo, which reuses one by option identity.
 */
export function sameViewerPlaceholder<T>(
    scope: Scope,
    previous: T | undefined,
    previousKey: readonly unknown[] | undefined,
): T | undefined {
    return previousKey?.[2] === scope ? previous : undefined;
}

function serverPath(
    serverId: number,
    rest: string,
    vehicles: boolean,
    prefab: string | null = null,
): string {
    const q = new URLSearchParams({ includeVehicles: String(vehicles) });
    if (prefab !== null) q.set('prefab', prefab);
    return `${VALHEIM_ARMORY_PATH}/servers/${encodePathSegment(String(serverId))}/${rest}?${q.toString()}`;
}

/** `GET …/servers/:id/materials?includeVehicles` — shared + personal totals. */
export function useValheimMaterials(
    serverId: number,
    includeVehicles: boolean,
): UseQueryResult<ValheimMaterialsResponse> {
    const scope = useViewerCacheScope();
    return useQuery({
        queryKey: valheimMaterialsKeys.totals(scope, serverId, includeVehicles),
        queryFn: () =>
            fetchApi(
                serverPath(serverId, 'materials', includeVehicles),
                {},
                ValheimMaterialsResponseSchema,
            ),
        placeholderData: (prev, prevQuery) =>
            sameViewerPlaceholder(scope, prev, prevQuery?.queryKey),
        retry: false,
    });
}

/**
 * `GET …/servers/:id/containers?includeVehicles[&prefab]` — the visible
 * chests; with `prefab`, only those holding that item (the drill-down).
 */
export function useValheimContainers(
    serverId: number,
    includeVehicles: boolean,
    prefab: string | null,
): UseQueryResult<ValheimContainerListResponse> {
    const scope = useViewerCacheScope();
    return useQuery({
        queryKey: valheimMaterialsKeys.containers(
            scope,
            serverId,
            includeVehicles,
            prefab,
        ),
        queryFn: () =>
            fetchApi(
                serverPath(serverId, 'containers', includeVehicles, prefab),
                {},
                ValheimContainerListResponseSchema,
            ),
        placeholderData: (prev, prevQuery) =>
            sameViewerPlaceholder(scope, prev, prevQuery?.queryKey),
        retry: false,
    });
}

/**
 * `GET …/servers/:id/containers/:key` — one chest's stacks; idle while `key` is null.
 * A 404 (deleted, made personal, hub hidden) resolves to `null` so it REPLACES
 * any cached stacks instead of leaving them beside an error (Codex r5).
 */
export function useValheimContainer(
    serverId: number,
    includeVehicles: boolean,
    key: string | null,
): UseQueryResult<ValheimContainerDetail | null> {
    const scope = useViewerCacheScope();
    return useQuery({
        queryKey: valheimMaterialsKeys.container(
            scope,
            serverId,
            includeVehicles,
            key ?? '',
        ),
        queryFn: () =>
            fetchApi(
                serverPath(
                    serverId,
                    `containers/${encodePathSegment(key ?? '')}`,
                    includeVehicles,
                ),
                {},
                ValheimContainerDetailSchema,
            ).catch((err: unknown) => {
                if (httpStatusOf(err) === 404) return null;
                throw err;
            }),
        enabled: key !== null,
        retry: false,
    });
}
