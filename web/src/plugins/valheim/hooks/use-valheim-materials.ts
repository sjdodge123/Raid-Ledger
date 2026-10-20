/**
 * ROK-1853 — data hooks for the hub Materials tab. Every response depends on
 * the viewer (personal chests, D9: `private, no-store`), so each key carries
 * `useViewerCacheScope()`; claim / owner mutations invalidate the
 * `valheimMaterialsKeys.all` prefix (`use-valheim-claims.ts`).
 */
import {
    keepPreviousData,
    useQuery,
    type UseQueryResult,
} from '@tanstack/react-query';
import {
    ValheimContainerDetailSchema,
    ValheimContainerListResponseSchema,
    ValheimMaterialsResponseSchema,
    type ValheimContainerDetail,
    type ValheimContainerListResponse,
    type ValheimMaterialsResponse,
} from '@raid-ledger/contract';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';
import { VALHEIM_ARMORY_PATH } from '../lib/valheim-armory-api';

type Scope = number | 'anon';

export const valheimMaterialsKeys = {
    all: ['valheim', 'materials'] as const,
    totals: (scope: Scope, serverId: number, vehicles: boolean) =>
        [...valheimMaterialsKeys.all, scope, serverId, vehicles] as const,
    containers: (scope: Scope, serverId: number, vehicles: boolean) =>
        [
            ...valheimMaterialsKeys.all,
            scope,
            serverId,
            vehicles,
            'containers',
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

function serverPath(serverId: number, rest: string, vehicles: boolean): string {
    const q = new URLSearchParams({ includeVehicles: String(vehicles) });
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
        placeholderData: keepPreviousData,
        retry: false,
    });
}

/** `GET …/servers/:id/containers?includeVehicles` — the visible chests. */
export function useValheimContainers(
    serverId: number,
    includeVehicles: boolean,
): UseQueryResult<ValheimContainerListResponse> {
    const scope = useViewerCacheScope();
    return useQuery({
        queryKey: valheimMaterialsKeys.containers(
            scope,
            serverId,
            includeVehicles,
        ),
        queryFn: () =>
            fetchApi(
                serverPath(serverId, 'containers', includeVehicles),
                {},
                ValheimContainerListResponseSchema,
            ),
        placeholderData: keepPreviousData,
        retry: false,
    });
}

/** `GET …/servers/:id/containers/:key` — one chest's stacks; idle while `key` is null. */
export function useValheimContainer(
    serverId: number,
    includeVehicles: boolean,
    key: string | null,
): UseQueryResult<ValheimContainerDetail> {
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
            ),
        enabled: key !== null,
        retry: false,
    });
}
