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
import { PLANNER_NO_SET_COPY, PLANNER_NO_STOCK_COPY, stockAgeLabel, type PlannerTarget } from './planner.helpers';
import { RecipeTree } from './recipe-tree';
import { isHiddenTarget, SPOILERS_EMPTY_COPY } from './spoilers.helpers';
import { ShoppingList } from './shopping-list';
import { usePlannerNames } from './use-planner-names';
import { usePlannerState, usePlannerTargets, type PlannerState } from './use-planner-state';

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
function PlanPane({ plan, names }: Pick<PlannerState, 'plan' | 'names'>): JSX.Element {
    const rootKinds = useMemo(() => plan.data?.targets.map((t) => t.kind) ?? [], [plan.data]);
    if (plan.data !== undefined)
        return (
            <div className="space-y-2">
                {plan.data.stock === 'none' && <p role="status" className="text-sm text-muted">{PLANNER_NO_STOCK_COPY}</p>}
                <RecipeTree nodes={plan.data.nodes} truncated={plan.data.truncated} names={names} label="What your list needs" rootKinds={rootKinds} stationBuilds={plan.data.stationBuilds} />
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
                names={s.names} onAdd={s.onAdd} atCap={s.atCap} idle={<PlanPane plan={s.plan} names={s.names} />} />
            <ShoppingList targets={s.targets} plan={s.plan.data} names={s.names} onRemove={s.onRemove} isHidden={s.isHidden} />
        </div>
    );
}

function EmptyState({ copy }: { copy: string }): JSX.Element {
    return (
        <div className="py-12 text-center">
            <p className="text-sm text-muted">{copy}</p>
        </div>
    );
}

/**
 * ROK-1948: protected with nothing visible. Saved targets stay manageable —
 * their generic hidden rows and Remove controls still render under the copy.
 * With no visible entries every saved target is hidden, so there is no plan
 * (hidden targets never reach `/plan`) and no materials scope to offer: only
 * the stored list is read, never the full `usePlannerState` and its queries.
 */
function ProtectedEmpty({ serverId, catalog }: { serverId: number; catalog: ValheimRecipeCatalogResponse }): JSX.Element {
    const [targets, setTargets] = usePlannerTargets(serverId);
    const names = usePlannerNames(serverId, catalog, undefined, undefined, 'plan');
    const isHidden = (t: PlannerTarget): boolean => isHiddenTarget(catalog, t);
    const onRemove = (i: number): void => setTargets(targets.filter((_, j) => j !== i));
    return (
        <div className="space-y-4">
            <EmptyState copy={SPOILERS_EMPTY_COPY} />
            {targets.length > 0 && <ShoppingList targets={targets} plan={undefined} names={names} onRemove={onRemove} isHidden={isHidden} />}
        </div>
    );
}

/** Why the Planner has nothing to craft (ROK-1948: protected-and-empty is its own state), or null. */
type PlannerEmpty = { kind: 'protected' } | { kind: 'empty'; copy: string } | null;

function plannerEmpty(c: ValheimRecipeCatalogResponse): PlannerEmpty {
    if (c.capturedAt !== null && c.entries.length === 0 && c.spoilers === 'protected') return { kind: 'protected' };
    return c.capturedAt === null || c.entries.length === 0 ? { kind: 'empty', copy: PLANNER_NO_SET_COPY } : null;
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
    const empty = plannerEmpty(q.data);
    if (empty?.kind === 'protected') return <ProtectedEmpty key={serverId} serverId={serverId} catalog={q.data} />;
    if (empty?.kind === 'empty') return <EmptyState copy={empty.copy} />;
    // Keyed by server: moving between two cached hubs remounts the body, so
    // one server's list never shows (or saves) under another's.
    return <PlannerBody key={serverId} serverId={serverId} catalog={q.data} />;
}
