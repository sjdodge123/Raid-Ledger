/**
 * ROK-1854 / ROK-1899 — the Planner tab's state: the list filters (also the
 * stock scope), the shopping list (kept per browser per server, D12), the
 * plan query and the names the list and window render with.
 */
import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ValheimRecipeCatalogResponse, ValheimRecipePlanResponse } from '@raid-ledger/contract';
import { useValheimMaterials } from '../hooks/use-valheim-materials';
import { useValheimRecipePlan } from '../hooks/use-valheim-recipes';
import { loadPlannerTargets, savePlannerTargets } from './planner-storage';
import {
    addPlannerTarget,
    DEFAULT_PLANNER_FILTERS,
    PLANNER_TARGETS_MAX,
    serializeTargets,
    type PlannerFilters,
    type PlannerTarget,
} from './planner.helpers';
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
}

function usePlannerTargets(serverId: number): [PlannerTarget[], (next: PlannerTarget[]) => void] {
    const [targets, setTargets] = useState(() => loadPlannerTargets(serverId));
    const update = (next: PlannerTarget[]): void => {
        setTargets(next);
        savePlannerTargets(serverId, next);
    };
    return [targets, update];
}

/** The Planner tab's filters, list, plan and names; see the module doc. */
export function usePlannerState(serverId: number, catalog: ValheimRecipeCatalogResponse): PlannerState {
    const [filters, setFilters] = useState<PlannerFilters>(DEFAULT_PLANNER_FILTERS);
    const [targets, setTargets] = usePlannerTargets(serverId);
    const hasPersonal = useValheimMaterials(serverId, filters.includeVehicles).data?.personal != null;
    const plan = useValheimRecipePlan(serverId, serializeTargets(targets), filters.includePersonal && hasPersonal, filters.includeVehicles);
    const names = usePlannerNames(serverId, catalog, plan.data, undefined, 'plan');
    const onAdd = (target: PlannerTarget): boolean => {
        const next = addPlannerTarget(targets, target);
        if (next === null) return false;
        setTargets(next);
        return true;
    };
    const onRemove = (i: number): void => setTargets(targets.filter((_, j) => j !== i));
    const atCap = targets.length >= PLANNER_TARGETS_MAX;
    return { filters, setFilters, targets, hasPersonal, plan, names, onAdd, onRemove, atCap };
}
