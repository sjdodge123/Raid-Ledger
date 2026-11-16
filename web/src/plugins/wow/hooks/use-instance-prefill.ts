/**
 * ROK-2215 (L2) — resolves a plan link's `contentInstanceIds` to the dungeon
 * the Create Event content browser would have selected by hand. Only the
 * game's own dungeon list is read, so raid ids and unknown ids drop out; one
 * dungeon per plan, so only the first hit is kept. A row without a minimum
 * level (retail journal rows) is completed from the instance detail, exactly
 * as a manual tick does.
 */
import { useMemo } from 'react';
import type { WowInstanceDetailDto, WowInstanceDto } from '@raid-ledger/contract';
import { useWowInstances, useWowInstanceDetail } from './use-wow-instances';
import { getWowVariant } from '../utils';
import { buildBasicInstanceDetail } from '../lib/instance-detail';

export interface InstancePrefill {
    instances: WowInstanceDetailDto[];
    /** True only while the dungeon list (or the hit's detail) is being fetched for a non-empty request. */
    isLoading: boolean;
}

/** The selected-instance shape a manual pick of `hit` produces, given its fetched detail (if any). */
function toSelected(hit: WowInstanceDto, detail: WowInstanceDetailDto | undefined): WowInstanceDetailDto {
    if (hit.minimumLevel != null) return buildBasicInstanceDetail(hit, 'dungeon');
    if (!detail) return { ...buildBasicInstanceDetail(hit, 'dungeon'), minimumLevel: null };
    return hit.shortName && !detail.shortName ? { ...detail, shortName: hit.shortName } : detail;
}

/** The first requested id found in the game's dungeon list, as a selected-instance detail. */
export function useInstancePrefill(gameSlug: string | null | undefined, ids: number[]): InstancePrefill {
    const variant = gameSlug ? getWowVariant(gameSlug) : null;
    const active = variant !== null && ids.length > 0;
    const query = useWowInstances(active ? variant : undefined, active ? 'dungeon' : undefined);
    const rows = query.data?.data;
    const hit = useMemo(() => {
        if (!active || !rows) return null;
        return ids.map((id) => rows.find((r) => r.id === id)).find((r) => r !== undefined) ?? null;
    }, [active, rows, ids]);
    const needsDetail = hit !== null && hit.minimumLevel == null && variant !== null;
    const detail = useWowInstanceDetail(needsDetail ? hit.id : undefined, needsDetail ? variant : undefined);
    const instances = useMemo(() => (hit ? [toSelected(hit, detail.data)] : []), [hit, detail.data]);
    return { instances, isLoading: active && (query.isLoading || (needsDetail && detail.isLoading)) };
}
