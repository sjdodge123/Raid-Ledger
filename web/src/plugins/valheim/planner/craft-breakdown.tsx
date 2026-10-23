/**
 * ROK-1899 — the detail pane's "Full breakdown" disclosure (spec §3.1.3,
 * OQ9): the existing `RecipeTree` for the selection, open on desktop and
 * collapsed in the phone sheet. CRAFT reads the tree route at q1; UPGRADE
 * reads the plan route for the single `quality − 1 → quality` step (the tree
 * route has no `fromQuality`).
 */
import { useMemo, type JSX } from 'react';
import type { ValheimPlanNode, ValheimRecipeCatalogEntry, ValheimRecipeCatalogResponse } from '@raid-ledger/contract';
import { MapError } from '../map/map-error';
import { useValheimRecipePlan, useValheimRecipeTree } from '../hooks/use-valheim-recipes';
import type { CraftMode } from './crafting.helpers';
import { serializeTargets } from './planner.helpers';
import { RecipeTree } from './recipe-tree';
import { usePlannerNames, type PlannerNameSource } from './use-planner-names';

/** Which chests the plan route counts (mirrors the window's filters). */
export interface BreakdownStockScope {
    personal: boolean;
    vehicles: boolean;
}

export interface CraftBreakdownProps {
    serverId: number;
    catalog: ValheimRecipeCatalogResponse;
    entry: ValheimRecipeCatalogEntry;
    mode: CraftMode;
    quality: number;
    stock: BreakdownStockScope;
    defaultOpen: boolean;
}

interface BreakdownData extends PlannerNameSource {
    nodes: readonly ValheimPlanNode[];
    truncated: boolean;
}

interface BreakdownQuery {
    data: BreakdownData | undefined;
    isError: boolean;
    refetch: () => unknown;
}

function useBreakdownQuery({ serverId, entry, mode, quality, stock }: CraftBreakdownProps): BreakdownQuery {
    const upgrade = mode === 'upgrade';
    const tree = useValheimRecipeTree(serverId, upgrade ? null : entry.prefab, entry.kind, 1);
    const targets = upgrade ? serializeTargets([{ prefab: entry.prefab, kind: 'item', quality, fromQuality: quality - 1, amount: 1 }]) : '';
    const plan = useValheimRecipePlan(serverId, targets, stock.personal, stock.vehicles);
    const q = upgrade ? plan : tree;
    return { data: q.data, isError: q.isError, refetch: q.refetch };
}

function BreakdownBody({ props, q }: { props: CraftBreakdownProps; q: BreakdownQuery }): JSX.Element {
    const { serverId, catalog, entry } = props;
    const names = usePlannerNames(serverId, catalog, undefined, q.data, 'tree');
    const kinds = useMemo(() => [entry.kind], [entry.kind]);
    if (q.data !== undefined)
        return <RecipeTree nodes={q.data.nodes} truncated={q.data.truncated} names={names} label={`What ${entry.name} needs`} rootKinds={kinds} />;
    if (q.isError) return <MapError text={`Couldn’t load what ${entry.name} needs.`} onRetry={() => void q.refetch()} />;
    return <p className="text-sm text-muted">Loading the breakdown…</p>;
}

/** The "Full breakdown" `<details>` hosting the requirement tree. */
export function CraftBreakdown(props: CraftBreakdownProps): JSX.Element {
    const q = useBreakdownQuery(props);
    return (
        <details open={props.defaultOpen} className="rounded-md border border-edge-subtle p-3">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">Full breakdown</summary>
            <div className="mt-3">
                <BreakdownBody props={props} q={q} />
            </div>
        </details>
    );
}
