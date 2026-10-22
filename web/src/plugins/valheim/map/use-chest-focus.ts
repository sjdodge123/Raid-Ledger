/** ROK-1889 — read the Map tab's chest focus from the hash and resolve it server-side. */
import { createContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
    ValheimChestFocusSchema,
    type ValheimChestFocus,
    type ValheimMapGrid,
} from '@raid-ledger/contract';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchApi } from '../../../lib/api/fetch-api';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { valheimMaterialsKeys } from '../hooks/use-valheim-materials';
import {
    isNotFoundError,
    VALHEIM_ARMORY_PATH,
} from '../lib/valheim-armory-api';
import type { MapViewportCommands } from './map-viewport';
import {
    chestFocusQuery,
    chestMarkerPoint,
    parseChestFocus,
    type ChestFocusTarget,
} from './chest-focus';

/** The resolved focus for the map frame (null: none, loading, or not found). */
export const ChestFocusContext = createContext<ValheimChestFocus | null>(null);

function subscribe(onChange: () => void): () => void {
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
        window.removeEventListener('hashchange', onChange);
        window.removeEventListener('popstate', onChange);
    };
}

/** The hash's chest target, following `hashchange` / `popstate` (Back). */
export function useChestFocusTarget(): ChestFocusTarget | null {
    const hash = useSyncExternalStore(
        subscribe,
        () => window.location.hash,
        () => '',
    );
    return useMemo(() => parseChestFocus(hash), [hash]);
}

/** A 404 (gone, moved, or a personal chest you may not see) resolves to null. */
export function useChestFocus(serverId: number): {
    target: ChestFocusTarget | null;
    query: UseQueryResult<ValheimChestFocus | null>;
} {
    const target = useChestFocusTarget();
    const scope = useViewerCacheScope();
    const query = useQuery({
        queryKey: [
            ...valheimMaterialsKeys.all,
            scope,
            serverId,
            'focus',
            target,
        ],
        enabled: target !== null,
        retry: false,
        queryFn: async () => {
            if (target === null) return null;
            const path = `${VALHEIM_ARMORY_PATH}/servers/${serverId}/chest-focus?${chestFocusQuery(target)}`;
            try {
                return await fetchApi(path, {}, ValheimChestFocusSchema);
            } catch (e) {
                if (isNotFoundError(e)) return null;
                throw e;
            }
        },
    });
    return { target, query };
}

/** "piece_chest_wood · 6/10 slots · Iron ×12". */
export function chestFocusLabel(chest: ValheimChestFocus): string {
    const parts = [chest.prefab, `${chest.usedSlots}/${chest.slots} slots`];
    if (chest.held) parts.push(`${chest.held.prefab} ×${chest.held.count}`);
    return parts.join(' · ');
}

/** Centre the viewport on the chest once the commands and the focus exist. */
export function useCentreOnChest(
    commands: MapViewportCommands | null,
    grid: ValheimMapGrid,
    chest: ValheimChestFocus | null,
): void {
    useEffect(() => {
        if (commands === null || chest === null) return;
        commands.centreOn(chestMarkerPoint(grid, chest.x, chest.z));
    }, [commands, grid, chest]);
}
