/**
 * ROK-2215 (L2) — resolves a plan link's `contentInstanceIds` to the dungeon
 * the Create Event content browser would have selected by hand. Only the
 * game's own dungeon list is read, so raid ids and unknown ids drop out; one
 * dungeon per plan, so only the first hit is kept.
 */
import { useMemo } from 'react';
import type { WowInstanceDetailDto } from '@raid-ledger/contract';
import { useWowInstances } from './use-wow-instances';
import { getWowVariant } from '../utils';
import { buildBasicInstanceDetail } from '../lib/instance-detail';

export interface InstancePrefill {
    instances: WowInstanceDetailDto[];
    /** True only while the dungeon list is being fetched for a non-empty request. */
    isLoading: boolean;
}

/** The first requested id found in the game's dungeon list, as a selected-instance detail. */
export function useInstancePrefill(gameSlug: string | null | undefined, ids: number[]): InstancePrefill {
    const variant = gameSlug ? getWowVariant(gameSlug) : null;
    const active = variant !== null && ids.length > 0;
    const query = useWowInstances(active ? variant : undefined, active ? 'dungeon' : undefined);
    const rows = query.data?.data;
    const instances = useMemo(() => {
        if (!active || !rows) return [];
        const hit = ids.map((id) => rows.find((r) => r.id === id)).find((r) => r !== undefined);
        return hit ? [buildBasicInstanceDetail(hit, 'dungeon')] : [];
    }, [active, rows, ids]);
    return { instances, isLoading: active && query.isLoading };
}
