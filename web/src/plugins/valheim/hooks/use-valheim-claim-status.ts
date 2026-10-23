/**
 * ROK-1933 — the claim banner's server facts (viewer has a claim, unclaimed
 * count) in one request, whatever the list's size. `invalidateOwnership`
 * refreshes it after every claim, unclaim or reassign.
 *
 * Its own module because the Overview card's `useVisible` probe runs from the
 * eagerly-loaded `register.ts`: the fetcher (and its contract schemas) is
 * imported on demand so the armory client stays out of the app entry's graph.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ValheimClaimStatusResponse } from '@raid-ledger/contract';

/**
 * `valheimArmoryKeys.claimStatus(serverId)`, spelled out here: importing the
 * key factory would split it into a shared chunk preloaded by every route that
 * reaches the app entry. `use-valheim-claim-status.test.ts` pins the two equal.
 */
export function claimStatusQueryKey(
    serverId: number,
): readonly ['plugins', 'valheim', 'armory', 'claim-status', number] {
    return ['plugins', 'valheim', 'armory', 'claim-status', serverId] as const;
}

/** Loads the shape-locked claim-status fetcher on first use. */
async function fetchClaimStatus(serverId: number): Promise<ValheimClaimStatusResponse> {
    const { fetchValheimClaimStatus } = await import('../lib/valheim-armory-api');
    return fetchValheimClaimStatus(serverId);
}

/** The viewer's claim facts on a server; idle until a server id is known. */
export function useValheimClaimStatus(
    serverId: number,
): UseQueryResult<ValheimClaimStatusResponse> {
    return useQuery({
        queryKey: claimStatusQueryKey(serverId),
        queryFn: () => fetchClaimStatus(serverId),
        enabled: serverId > 0,
        staleTime: 30_000,
    });
}
