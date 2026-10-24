/**
 * ROK-1854 D10 / ROK-1899 — the hub Planner tab: the crafting window
 * (station switcher, CRAFT / UPGRADE, recipe list + detail) over the
 * shopping list netted against the chests. While nothing is selected the
 * detail column shows what the list needs (the plan's tree). The list is
 * kept per browser per server (D12).
 */
import { useMemo, type JSX } from 'react';
import type { ValheimRecipeCatalogResponse } from '@raid-ledger/contract';
import { useNow } from '../../../hooks/use-now';
import { MapError } from '../map/map-error';
import { useValheimRecipeCatalog } from '../hooks/use-valheim-recipes';
import { CraftingWindow } from './crafting-window';
import { hidesUndiscovered, PLANNER_NO_SET_COPY, PLANNER_NO_STOCK_COPY, stockAgeLabel } from './planner.helpers';
import { RecipeTree } from './recipe-tree';
import { ShoppingList } from './shopping-list';
import { usePlannerState, type PlannerState } from './use-planner-state';

function HeaderLine({ catalog, capturedAt }: { catalog: ValheimRecipeCatalogResponse; capturedAt: string | null }): JSX.Element {
    const now = useNow();
    return (
        <p className="text-xs text-muted" data-testid="valheim-planner-header">
            Recipes from {catalog.gameVersion ?? 'an unknown game version'}
            {capturedAt !== null && ` · ${stockAgeLabel(capturedAt, now)}`}
        </p>
    );
}

/** The idle detail column: what the list needs, its error with a Retry, or the idle prompt. */
function PlanPane({ plan, names, filters }: Pick<PlannerState, 'plan' | 'names' | 'filters'>): JSX.Element {
    const rootKinds = useMemo(() => plan.data?.targets.map((t) => t.kind) ?? [], [plan.data]);
    if (plan.data !== undefined)
        return (
            <div className="space-y-2">
                {plan.data.stock === 'none' && <p role="status" className="text-sm text-muted">{PLANNER_NO_STOCK_COPY}</p>}
                <RecipeTree nodes={plan.data.nodes} truncated={plan.data.truncated} names={names} label="What your list needs" rootKinds={rootKinds}
                    hideUndiscovered={hidesUndiscovered(filters, plan.data.discovery)} />
            </div>
        );
    if (plan.isError) return <MapError text="Couldn’t load your list’s plan." onRetry={() => void plan.refetch()} />;
    return <p className="text-sm text-muted">Pick an item or piece to see what it takes.</p>;
}

function PlannerBody({ serverId, catalog }: { serverId: number; catalog: ValheimRecipeCatalogResponse }): JSX.Element {
    const s = usePlannerState(serverId, catalog);
    return (
        <div className="space-y-4">
            <HeaderLine catalog={catalog} capturedAt={s.plan.data?.stock === 'scan' ? s.plan.data.capturedAt : null} />
            <CraftingWindow serverId={serverId} catalog={catalog} filters={s.filters} onFilters={s.setFilters} hasPersonal={s.hasPersonal}
                names={s.names} onAdd={s.onAdd} atCap={s.atCap} idle={<PlanPane plan={s.plan} names={s.names} filters={s.filters} />} />
            <ShoppingList targets={s.targets} plan={s.plan.data} names={s.names} onRemove={s.onRemove} />
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
    // Keyed by server: moving between two cached hubs remounts the body, so
    // one server's list never shows (or saves) under another's.
    return <PlannerBody key={serverId} serverId={serverId} catalog={q.data} />;
}
