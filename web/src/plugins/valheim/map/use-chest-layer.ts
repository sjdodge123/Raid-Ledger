/**
 * ROK-1859 D12/D13 — the Map's Chests layer: the existing `/containers` read
 * (same hook and cache as the Materials tab, carts and ships included) as
 * pins, plus the Materials read's `bases` for the display names. Hub-only, and
 * fetched only while the "Chests" chip can show. Pins draw only over the map
 * of the containers' own world.
 */
import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ValheimContainerSummary, ValheimMapPin, ValheimMaterialsBase } from '@raid-ledger/contract';
import { useItemIconsFor, type ItemIconContext } from '../character/use-item-icons';
import { useValheimContainers, useValheimMaterials } from '../hooks/use-valheim-materials';
import { chestDisplayName } from '../materials/materials-bases.helpers';
import { filterChests } from './chest-pins';
import type { PinFilter } from './pin-filter';
import { httpStatusOf } from '../../../lib/api/api-error';
import { portalLayerFailed, type PinFilterSummary } from './pin-filter-summary';

export type ChestLayerSummary = Pick<
    PinFilterSummary,
    'chestsError' | 'chestsPending' | 'chestsOtherWorld' | 'onRetryChests'
>;

export interface ChestLayer {
    /** Index-aligned with `chests`. */
    pins: readonly ValheimMapPin[];
    chests: readonly ValheimContainerSummary[];
    bases: readonly ValheimMaterialsBase[];
    ctx: ItemIconContext;
    summary: ChestLayerSummary;
}

/** The Chests chip can show (D16: on by default, like every chip). */
const chipOn = (filter: PinFilter): boolean => filter.types === null || filter.types.has('chest');

/**
 * A 403/404 means the viewer lost access (hub left, chest list revoked): the
 * cache still holds the old read, which must not keep drawing pins.
 */
const accessLost = (q: Pick<UseQueryResult, 'isError' | 'error'>): boolean => {
    const status = q.isError ? httpStatusOf(q.error) : undefined;
    return status === 403 || status === 404;
};

export function useChestLayer(filter: PinFilter, serverId: number | undefined, worldUid: string): ChestLayer {
    const on0 = serverId !== undefined && chipOn(filter);
    const query = useValheimContainers(serverId ?? 0, true, null, on0);
    const totals = useValheimMaterials(serverId ?? 0, true, on0);
    const on = on0 && !accessLost(query) && !accessLost(totals);
    const data = on ? query.data : undefined;
    const bases = (on ? totals.data?.bases : undefined) ?? [];
    const items = useMemo(() => ({ ...data?.items, ...totals.data?.items }), [data?.items, totals.data?.items]);
    const ctx = useItemIconsFor({ serverId: serverId ?? 0, items, atlas: data?.atlas ?? null });
    // D13: a scan of another world never overlays this map.
    const otherWorld = data !== undefined && data.worldUid !== null && data.worldUid !== worldUid;
    const sameWorld = data !== undefined && data.worldUid === worldUid ? data.containers : [];
    const kept = filterChests(sameWorld, filter, (c) => chestDisplayName(c, bases, ctx));
    return {
        ...kept,
        bases,
        ctx,
        summary: {
            // The base names come from /materials: its read gates the layer too.
            chestsError: on0 && (portalLayerFailed(query) || portalLayerFailed(totals)),
            chestsPending: on && (query.isPending || totals.isPending),
            chestsOtherWorld: on && otherWorld,
            onRetryChests: () => {
                if (query.isError) void query.refetch();
                if (totals.isError) void totals.refetch();
            },
        },
    };
}
