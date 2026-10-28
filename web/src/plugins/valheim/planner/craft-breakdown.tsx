/**
 * ROK-1899 — the detail pane's "Full breakdown" disclosure (spec §3.1.3,
 * OQ9): the existing `RecipeTree` for the selection, open on desktop and
 * collapsed in the phone sheet. Both modes read the plan route, so every node
 * carries the viewer's have/short (the tree route has no stock): CRAFT plans
 * the pick at q1 × the footer's amount, UPGRADE the single
 * `quality − 1 → quality` step.
 */
import { useMemo, useState, type JSX } from 'react';
import type { ValheimPlanNode, ValheimRecipeCatalogEntry, ValheimRecipeCatalogResponse, ValheimStationBuilds } from '@raid-ledger/contract';
import { MapError } from '../map/map-error';
import { useValheimRecipePlan } from '../hooks/use-valheim-recipes';
import type { CraftMode } from './crafting.helpers';
import { serializeSources, serializeTargets, type PlannerTarget } from './planner.helpers';
import { RecipeTree } from './recipe-tree';
import { usePlannerNames, type PlannerNameSource } from './use-planner-names';
import { usePlannerSourcesContext, useSourceChooser } from './use-source-chooser';

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
    /** CRAFT: how many to plan (the footer's valid amount, else 1). */
    amount: number;
    stock: BreakdownStockScope;
    defaultOpen: boolean;
}

interface BreakdownData extends PlannerNameSource {
    nodes: readonly ValheimPlanNode[];
    truncated: boolean;
    stationBuilds?: ValheimStationBuilds | undefined;
}

interface BreakdownQuery {
    data: BreakdownData | undefined;
    isError: boolean;
    refetch: () => unknown;
}

/** The one target the breakdown plans: CRAFT from scratch at q1 × amount, UPGRADE one step. */
function breakdownTarget({ entry, mode, quality, amount }: CraftBreakdownProps): PlannerTarget {
    if (mode === 'upgrade') return { prefab: entry.prefab, kind: 'item', quality, fromQuality: quality - 1, amount: 1 };
    return { prefab: entry.prefab, kind: entry.kind, quality: 1, fromQuality: 0, amount };
}

function useBreakdownQuery(props: CraftBreakdownProps): BreakdownQuery {
    const targets = serializeTargets([breakdownTarget(props)]);
    // ROK-1860 D10: the breakdown honours the viewer's source picks (the card cost stays D9).
    const picks = usePlannerSourcesContext();
    const sources = picks === null ? '' : serializeSources(picks.sources);
    const q = useValheimRecipePlan(props.serverId, targets, props.stock.personal, props.stock.vehicles, sources);
    return { data: q.data, isError: q.isError, refetch: q.refetch };
}

function BreakdownBody({ props, q }: { props: CraftBreakdownProps; q: BreakdownQuery }): JSX.Element {
    const { serverId, catalog, entry } = props;
    const names = usePlannerNames(serverId, catalog, q.data, undefined, 'plan');
    const kinds = useMemo(() => [entry.kind], [entry.kind]);
    const { chooser, picker } = useSourceChooser(catalog, names);
    if (q.data !== undefined)
        return (
            <>
                <RecipeTree nodes={q.data.nodes} truncated={q.data.truncated} names={names} label={`What ${entry.name} needs`} rootKinds={kinds}
                    stationBuilds={q.data.stationBuilds} onChooseSource={chooser} />
                {picker}
            </>
        );
    if (q.isError) return <MapError text={`Couldn’t load what ${entry.name} needs.`} onRetry={() => void q.refetch()} />;
    return <p className="text-sm text-muted">Loading the breakdown…</p>;
}

/** Mounted only once the disclosure has opened, so a collapsed one fetches nothing. */
function BreakdownContent({ props }: { props: CraftBreakdownProps }): JSX.Element {
    const q = useBreakdownQuery(props);
    return <BreakdownBody props={props} q={q} />;
}

/** The "Full breakdown" `<details>` hosting the requirement tree. */
export function CraftBreakdown(props: CraftBreakdownProps): JSX.Element {
    const [opened, setOpened] = useState(props.defaultOpen);
    return (
        <details open={props.defaultOpen} onToggle={(e) => e.currentTarget.open && setOpened(true)} className="rounded-md border border-edge-subtle p-3">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">Full breakdown</summary>
            <div className="mt-3">{opened && <BreakdownContent props={props} />}</div>
        </details>
    );
}
