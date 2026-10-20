/**
 * ROK-1854 D10 — the hub Planner tab: pick a target, preview its
 * requirement tree, add it to a shopping list netted against the chests.
 * ≥1024px two columns (picker + list | tree); below, stacked with the list
 * after the tree. The list is kept per browser per server (D12).
 */
import { useState, type JSX } from 'react';
import type { ValheimRecipeCatalogEntry, ValheimRecipeCatalogResponse } from '@raid-ledger/contract';
import { useNow } from '../../../hooks/use-now';
import { useValheimMaterials } from '../hooks/use-valheim-materials';
import { useValheimRecipeCatalog, useValheimRecipePlan, useValheimRecipeTree } from '../hooks/use-valheim-recipes';
import { loadPlannerTargets, savePlannerTargets } from './planner-storage';
import { PlannerTargetPicker } from './planner-target-picker';
import {
    DEFAULT_PLANNER_FILTERS,
    PLANNER_AMOUNT_MAX,
    PLANNER_NO_SET_COPY,
    PLANNER_NO_STOCK_COPY,
    serializeTargets,
    stockAgeLabel,
    type PlannerFilters,
    type PlannerTarget,
} from './planner.helpers';
import { RecipeTree } from './recipe-tree';
import { ShoppingList } from './shopping-list';
import { usePlannerNames } from './use-planner-names';

type Entry = ValheimRecipeCatalogEntry;

function addTarget(list: readonly PlannerTarget[], e: Entry, quality: number, amount: number): PlannerTarget[] {
    const q = e.kind === 'piece' ? 1 : quality;
    const i = list.findIndex((t) => t.prefab === e.prefab && t.quality === q);
    if (i < 0) return [...list, { prefab: e.prefab, kind: e.kind, quality: q, amount }];
    return list.map((t, j) => (j === i ? { ...t, amount: Math.min(PLANNER_AMOUNT_MAX, t.amount + amount) } : t));
}

function usePlannerTargets(serverId: number): [PlannerTarget[], (next: PlannerTarget[]) => void] {
    const [targets, setTargets] = useState(() => loadPlannerTargets(serverId));
    const update = (next: PlannerTarget[]): void => {
        setTargets(next);
        savePlannerTargets(serverId, next);
    };
    return [targets, update];
}

function HeaderLine({ catalog, capturedAt }: { catalog: ValheimRecipeCatalogResponse; capturedAt: string | null }): JSX.Element {
    const now = useNow();
    return (
        <p className="text-xs text-muted" data-testid="valheim-planner-header">
            Recipes from {catalog.gameVersion ?? 'an unknown game version'}
            {capturedAt !== null && ` · ${stockAgeLabel(capturedAt, now)}`}
        </p>
    );
}

function usePlannerState(serverId: number, catalog: ValheimRecipeCatalogResponse) {
    const [filters, setFilters] = useState<PlannerFilters>(DEFAULT_PLANNER_FILTERS);
    const [picked, setPicked] = useState<Entry | null>(null);
    const [quality, setQuality] = useState(1);
    const [targets, setTargets] = usePlannerTargets(serverId);
    const hasPersonal = useValheimMaterials(serverId, filters.includeVehicles).data?.personal != null;
    const plan = useValheimRecipePlan(serverId, serializeTargets(targets), filters.includePersonal && hasPersonal, filters.includeVehicles);
    const tree = useValheimRecipeTree(serverId, picked?.prefab ?? null, picked?.kind ?? 'item', quality);
    const names = usePlannerNames(serverId, catalog, plan.data, tree.data);
    const onPick = (e: Entry | null): void => {
        setPicked(e);
        setQuality(1);
    };
    const onAdd = (amount: number): void => {
        if (picked === null) return;
        setTargets(addTarget(targets, picked, quality, amount));
        setPicked(null);
    };
    const onRemove = (i: number): void => setTargets(targets.filter((_, j) => j !== i));
    return { filters, setFilters, picked, onPick, quality, setQuality, targets, hasPersonal, plan, tree, names, onAdd, onRemove };
}

function PlannerBody({ serverId, catalog }: { serverId: number; catalog: ValheimRecipeCatalogResponse }): JSX.Element {
    const { filters, setFilters, picked, onPick, quality, setQuality, targets, hasPersonal, plan, tree, names, onAdd, onRemove } =
        usePlannerState(serverId, catalog);
    const shown = picked !== null ? tree.data : plan.data;
    const label = picked !== null ? `What ${picked.name} needs` : 'What your list needs';
    return (
        <div className="space-y-4">
            <HeaderLine catalog={catalog} capturedAt={plan.data?.stock === 'scan' ? plan.data.capturedAt : null} />
            <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2">
                <div className="lg:col-start-1 lg:row-start-1">
                    <PlannerTargetPicker entries={catalog.entries} filters={filters} onFilters={setFilters} hasPersonal={hasPersonal}
                        picked={picked} onPick={onPick} quality={quality} onQuality={setQuality} onAdd={onAdd} />
                </div>
                <div className="space-y-2 lg:col-start-2 lg:row-span-2 lg:row-start-1">
                    {picked === null && plan.data?.stock === 'none' && <p role="status" className="text-sm text-muted">{PLANNER_NO_STOCK_COPY}</p>}
                    {shown === undefined ? (
                        <p className="text-sm text-muted">Pick an item or piece to see what it takes.</p>
                    ) : (
                        <RecipeTree key={label} nodes={shown.nodes} truncated={shown.truncated} names={names} label={label} />
                    )}
                </div>
                <div className="lg:col-start-1 lg:row-start-2">
                    <ShoppingList targets={targets} plan={plan.data} names={names} onRemove={onRemove} />
                </div>
            </div>
        </div>
    );
}

export function ValheimPlannerTab({ serverId }: { serverId: number }): JSX.Element {
    const q = useValheimRecipeCatalog(serverId);
    if (q.isPending) return <p className="py-12 text-center text-sm text-muted">Loading recipes…</p>;
    if (q.isError)
        return (
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                Couldn’t load recipes. Try again in a moment.
            </p>
        );
    if (q.data.capturedAt === null || q.data.entries.length === 0)
        return (
            <div className="py-12 text-center">
                <p className="text-sm text-muted">{PLANNER_NO_SET_COPY}</p>
            </div>
        );
    return <PlannerBody serverId={serverId} catalog={q.data} />;
}
