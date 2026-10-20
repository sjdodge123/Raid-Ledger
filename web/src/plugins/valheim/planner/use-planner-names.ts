/**
 * ROK-1854 — names and icon contexts for planner rows. Items draw from the
 * item atlas, pieces and stations from the recipe atlas — the same
 * `useItemIconsFor` hook with a different catalogue record, no fork.
 */
import { useMemo } from 'react';
import type {
    ValheimCatalogEntry,
    ValheimMapBaseMap,
    ValheimPlanNode,
    ValheimRecipeCatalogResponse,
} from '@raid-ledger/contract';
import type { PlannerKind } from './planner.helpers';
import {
    useItemIconsFor,
    type ItemIconContext,
} from '../character/use-item-icons';

/** Lookups take the kind: an item and a piece may share a prefab. */
export interface PlannerNames {
    nameOf: (prefab: string, kind: PlannerKind) => string;
    stationName: (prefab: string) => string;
    ctxFor: (prefab: string, kind: PlannerKind) => ItemIconContext;
}

/**
 * Root i is target i (the resolver pushes one root per target, in request
 * order); every ingredient below a root is an item.
 */
export function rootKindOf(
    nodes: readonly ValheimPlanNode[],
    rootKinds: readonly (PlannerKind | undefined)[],
): (node: ValheimPlanNode) => PlannerKind {
    const byId = new Map<number, PlannerKind>();
    for (const n of nodes) {
        if (n.parentId === null) byId.set(n.id, rootKinds[byId.size] ?? 'item');
    }
    return (node) => byId.get(node.id) ?? 'item';
}

type Record_ = Record<string, ValheimCatalogEntry>;

/** The catalogue subset a plan or tree response carries for its own nodes. */
export interface PlannerNameSource {
    items: Record_;
    itemAtlas: ValheimMapBaseMap | null;
}

function splitCatalog(catalog: ValheimRecipeCatalogResponse): {
    items: Record_;
    pieces: Record_;
} {
    const items: Record_ = {};
    const pieces: Record_ = {};
    for (const e of catalog.entries) {
        const target = e.kind === 'piece' ? pieces : items;
        target[e.prefab] = { name: e.name, category: e.category, icon: e.icon };
    }
    for (const s of catalog.stations)
        pieces[s.prefab] = { name: s.name, category: 'Station', icon: s.icon };
    return { items, pieces };
}

/**
 * Plan and tree responses both carry `items` for their nodes — gathered
 * leaves (Iron scrap) are outside the recipe catalogue, so merge both. All
 * three share the one items catalogue, so any present atlas fits them.
 */
export function usePlannerNames(
    serverId: number,
    catalog: ValheimRecipeCatalogResponse,
    plan: PlannerNameSource | undefined,
    tree: PlannerNameSource | undefined,
): PlannerNames {
    const { items, pieces } = useMemo(() => splitCatalog(catalog), [catalog]);
    const allItems = useMemo(
        () => ({ ...plan?.items, ...tree?.items, ...items }),
        [plan?.items, tree?.items, items],
    );
    const atlas = catalog.itemAtlas ?? tree?.itemAtlas ?? plan?.itemAtlas ?? null;
    const itemCtx = useItemIconsFor({ serverId, items: allItems, atlas });
    const pieceCtx = useItemIconsFor({ serverId, items: pieces, atlas: catalog.recipeAtlas });
    return useMemo(
        () => ({
            nameOf: (p, kind) =>
                (kind === 'piece' ? (pieces[p] ?? allItems[p]) : (allItems[p] ?? pieces[p]))?.name ?? p,
            stationName: (p) => pieces[p]?.name ?? p,
            ctxFor: (p, kind) => {
                const piece = kind === 'piece' ? pieces[p] !== undefined : allItems[p] === undefined && pieces[p] !== undefined;
                return piece ? pieceCtx : itemCtx;
            },
        }),
        [pieces, allItems, itemCtx, pieceCtx],
    );
}
