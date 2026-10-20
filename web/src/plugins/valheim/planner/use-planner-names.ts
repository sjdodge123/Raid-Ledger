/**
 * ROK-1854 — names and icon contexts for planner rows. Items draw from the
 * item atlas, pieces and stations from the recipe atlas — the same
 * `useItemIconsFor` hook with a different catalogue record, no fork.
 */
import { useMemo } from 'react';
import type {
    ValheimCatalogEntry,
    ValheimRecipeCatalogResponse,
} from '@raid-ledger/contract';
import {
    useItemIconsFor,
    type ItemIconContext,
} from '../character/use-item-icons';

export interface PlannerNames {
    nameOf: (prefab: string) => string;
    stationName: (prefab: string) => string;
    ctxFor: (prefab: string) => ItemIconContext;
}

type Record_ = Record<string, ValheimCatalogEntry>;

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

export function usePlannerNames(
    serverId: number,
    catalog: ValheimRecipeCatalogResponse,
    planItems: Record_ | undefined,
): PlannerNames {
    const { items, pieces } = useMemo(() => splitCatalog(catalog), [catalog]);
    const allItems = useMemo(() => ({ ...planItems, ...items }), [planItems, items]);
    const itemCtx = useItemIconsFor({ serverId, items: allItems, atlas: catalog.itemAtlas });
    const pieceCtx = useItemIconsFor({ serverId, items: pieces, atlas: catalog.recipeAtlas });
    return useMemo(
        () => ({
            nameOf: (p) => pieces[p]?.name ?? allItems[p]?.name ?? p,
            stationName: (p) => pieces[p]?.name ?? p,
            ctxFor: (p) => (pieces[p] === undefined ? itemCtx : pieceCtx),
        }),
        [pieces, allItems, itemCtx, pieceCtx],
    );
}
