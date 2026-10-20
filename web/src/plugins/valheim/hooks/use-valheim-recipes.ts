/**
 * ROK-1854 — data hooks for the hub Planner tab. The plan nets the viewer's
 * own chests and the catalogue/tree depend on the hub-hidden check (D8:
 * `private, no-store`), so every key carries `useViewerCacheScope()` at
 * index 2; claim / owner mutations invalidate `valheimRecipesKeys.all`.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
    ValheimRecipeCatalogResponseSchema,
    ValheimRecipePlanResponseSchema,
    ValheimRecipeTreeResponseSchema,
    type ValheimRecipeCatalogResponse,
    type ValheimRecipePlanResponse,
    type ValheimRecipeTreeResponse,
} from '@raid-ledger/contract';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';
import { VALHEIM_ARMORY_PATH } from '../lib/valheim-armory-api';
import type { PlannerKind } from '../planner/planner.helpers';
import { sameViewerPlaceholder } from './use-valheim-materials';

type Scope = number | 'anon';

export const valheimRecipesKeys = {
    all: ['valheim', 'recipes'] as const,
    catalog: (scope: Scope, serverId: number) =>
        [...valheimRecipesKeys.all, scope, serverId, 'catalog'] as const,
    tree: (
        scope: Scope,
        serverId: number,
        prefab: string,
        kind: PlannerKind,
        quality: number,
    ) =>
        [
            ...valheimRecipesKeys.all,
            scope,
            serverId,
            'tree',
            prefab,
            kind,
            quality,
        ] as const,
    plan: (
        scope: Scope,
        serverId: number,
        targets: string,
        personal: boolean,
        vehicles: boolean,
    ) =>
        [
            ...valheimRecipesKeys.all,
            scope,
            serverId,
            'plan',
            targets,
            personal,
            vehicles,
        ] as const,
};

function recipesPath(serverId: number, rest: string, q?: URLSearchParams): string {
    const base = `${VALHEIM_ARMORY_PATH}/servers/${encodePathSegment(String(serverId))}/recipes${rest}`;
    return q === undefined ? base : `${base}?${q.toString()}`;
}

/** `GET …/recipes` — every craftable target, the stations and both atlases. */
export function useValheimRecipeCatalog(
    serverId: number,
): UseQueryResult<ValheimRecipeCatalogResponse> {
    const scope = useViewerCacheScope();
    return useQuery({
        queryKey: valheimRecipesKeys.catalog(scope, serverId),
        queryFn: () =>
            fetchApi(recipesPath(serverId, ''), {}, ValheimRecipeCatalogResponseSchema),
        retry: false,
    });
}

/** `GET …/recipes/:prefab/tree?quality&kind` — idle while `prefab` is null. */
export function useValheimRecipeTree(
    serverId: number,
    prefab: string | null,
    kind: PlannerKind,
    quality: number,
): UseQueryResult<ValheimRecipeTreeResponse> {
    const scope = useViewerCacheScope();
    const q = new URLSearchParams({ quality: String(quality), kind });
    return useQuery({
        queryKey: valheimRecipesKeys.tree(scope, serverId, prefab ?? '', kind, quality),
        queryFn: () =>
            fetchApi(
                recipesPath(serverId, `/${encodePathSegment(prefab ?? '')}/tree`, q),
                {},
                ValheimRecipeTreeResponseSchema,
            ),
        enabled: prefab !== null,
        placeholderData: (prev, prevQuery) =>
            sameViewerPlaceholder(scope, prev, prevQuery?.queryKey),
        retry: false,
    });
}

/** `GET …/recipes/plan?targets&includePersonal&includeVehicles` — idle with no targets. */
export function useValheimRecipePlan(
    serverId: number,
    targets: string,
    includePersonal: boolean,
    includeVehicles: boolean,
): UseQueryResult<ValheimRecipePlanResponse> {
    const scope = useViewerCacheScope();
    const q = new URLSearchParams({
        targets,
        includePersonal: String(includePersonal),
        includeVehicles: String(includeVehicles),
    });
    return useQuery({
        queryKey: valheimRecipesKeys.plan(scope, serverId, targets, includePersonal, includeVehicles),
        queryFn: () =>
            fetchApi(recipesPath(serverId, '/plan', q), {}, ValheimRecipePlanResponseSchema),
        enabled: targets !== '',
        placeholderData: (prev, prevQuery) =>
            sameViewerPlaceholder(scope, prev, prevQuery?.queryKey),
        retry: false,
    });
}
