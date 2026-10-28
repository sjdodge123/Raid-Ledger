/**
 * ROK-1854 / ROK-1899 — the Planner tab's state: the list filters (also the
 * stock scope), the shopping list (kept per browser per server, D12), the
 * plan query and the names the list and window render with.
 */
import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ValheimRecipeCatalogResponse, ValheimRecipePlanResponse, ValheimRecipeSourceRef } from '@raid-ledger/contract';
import { useValheimMaterials } from '../hooks/use-valheim-materials';
import { useValheimRecipePlan } from '../hooks/use-valheim-recipes';
import { loadPlannerTargets, savePlannerTargets } from './planner-storage';
import { loadSourceOverrides, pruneSourceOverrides, saveSourceOverrides, type SourceOverrides } from './planner-sources';
import {
    addPlannerTarget,
    DEFAULT_PLANNER_FILTERS,
    PLANNER_TARGETS_MAX,
    serializeSources,
    serializeTargets,
    type PlannerFilters,
    type PlannerTarget,
} from './planner.helpers';
import { isHiddenTarget } from './spoilers.helpers';
import { usePlannerNames, type PlannerNames } from './use-planner-names';

export interface PlannerState {
    filters: PlannerFilters;
    setFilters: (next: PlannerFilters) => void;
    targets: PlannerTarget[];
    hasPersonal: boolean;
    plan: UseQueryResult<ValheimRecipePlanResponse>;
    names: PlannerNames;
    /** Adds (or merges) a target; false when refused at the cap — an over-cap list is never persisted. */
    onAdd: (target: PlannerTarget) => boolean;
    onRemove: (index: number) => void;
    atCap: boolean;
    /** ROK-1948 W5 — kept in storage, left out of `/plan`, rendered generically. */
    isHidden: (target: PlannerTarget) => boolean;
    /** ROK-1860 — the viewer's per-prefab source picks (D9), sent as `sources=`. */
    sources: SourceOverrides;
    /** Picks `ref` for `prefab`; null = "Use the default" (removes the pick). */
    setSource: (prefab: string, ref: ValheimRecipeSourceRef | null) => void;
}

/** The stored shopping list for `serverId` (D12) and a setter that persists it. */
export function usePlannerTargets(serverId: number): [PlannerTarget[], (next: PlannerTarget[]) => void] {
    const [targets, setTargets] = useState(() => loadPlannerTargets(serverId));
    const update = (next: PlannerTarget[]): void => {
        setTargets(next);
        savePlannerTargets(serverId, next);
    };
    return [targets, update];
}

/**
 * ROK-1860 D9 — the stored source picks for `serverId`, pruned against the
 * catalogue's `sourceOptions` on load, and a setter that persists them.
 */
export function usePlannerSources(
    serverId: number,
    catalog: Pick<ValheimRecipeCatalogResponse, 'entries'>,
): [SourceOverrides, (prefab: string, ref: ValheimRecipeSourceRef | null) => void] {
    const [sources, setSources] = useState(() => pruneSourceOverrides(loadSourceOverrides(serverId), catalog));
    const setSource = (prefab: string, ref: ValheimRecipeSourceRef | null): void => {
        const next: SourceOverrides = new Map(sources);
        if (ref === null) next.delete(prefab);
        else next.set(prefab, ref);
        setSources(next);
        saveSourceOverrides(serverId, next);
    };
    return [sources, setSource];
}

/** The Planner tab's filters, list, plan and names; see the module doc. */
export function usePlannerState(serverId: number, catalog: ValheimRecipeCatalogResponse): PlannerState {
    const [filters, setFilters] = useState<PlannerFilters>(DEFAULT_PLANNER_FILTERS);
    const [targets, setTargets] = usePlannerTargets(serverId);
    const [sources, setSource] = usePlannerSources(serverId, catalog);
    const hasPersonal = useValheimMaterials(serverId, filters.includeVehicles).data?.personal != null;
    const isHidden = (t: PlannerTarget): boolean => isHiddenTarget(catalog, t);
    const plan = useValheimRecipePlan(serverId, serializeTargets(targets.filter((t) => !isHidden(t))), filters.includePersonal && hasPersonal, filters.includeVehicles, serializeSources(sources));
    const names = usePlannerNames(serverId, catalog, plan.data, undefined, 'plan');
    const onAdd = (target: PlannerTarget): boolean => {
        const next = addPlannerTarget(targets, target);
        if (next === null) return false;
        setTargets(next);
        return true;
    };
    const onRemove = (i: number): void => setTargets(targets.filter((_, j) => j !== i));
    const atCap = targets.length >= PLANNER_TARGETS_MAX;
    return { filters, setFilters, targets, hasPersonal, plan, names, onAdd, onRemove, atCap, isHidden, sources, setSource };
}
