/**
 * ROK-2153 — core data layer for "claim your character" on a hub:
 * `GET /guilds/:id/claim` (status + candidates) and
 * `POST /guilds/:id/claim/:candidateId` (claim one).
 *
 * The status lives UNDER the hub page key, so anything that invalidates the
 * hub page (join, leave, a character change) refetches it too. A 404 means no
 * active provider serves this hub — an answer, not a blip, so 4xx never retry.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { HubClaimResultSchema, HubClaimStatusSchema, type HubClaimRequest, type HubClaimResult, type HubClaimStatus } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { httpStatusOf } from '../../../lib/api/api-error';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { guildPageKey } from '../api/use-guild';
import { invalidateAllHubMemberships } from '../community/invalidate-hub-membership';

const MAX_RETRIES = 2;

/** Prefix of every claim-status entry for one hub (the viewer goes last). */
export function hubClaimKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'claim'];
}

/** `['me', 'characters']` — the viewer's character list, which a claim adds to. */
export const MY_CHARACTERS_KEY = ['me', 'characters'] as const;

export function fetchHubClaim(guildId: number): Promise<HubClaimStatus> {
    return fetchApi(`/guilds/${guildId}/claim`, {}, HubClaimStatusSchema);
}

export function postHubClaim(guildId: number, candidateId: string, body: HubClaimRequest): Promise<HubClaimResult> {
    const path = `/guilds/${guildId}/claim/${encodeURIComponent(candidateId)}`;
    return fetchApi(path, { method: 'POST', body: JSON.stringify(body) }, HubClaimResultSchema);
}

function retryUnlessClientError(failures: number, error: Error): boolean {
    const status = httpStatusOf(error);
    if (status !== undefined && status >= 400 && status < 500) return false;
    return failures < MAX_RETRIES;
}

/** The claim status for `guildId`; viewer-scoped like the hub page. */
export function useHubClaim(guildId: number, enabled: boolean): UseQueryResult<HubClaimStatus, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...hubClaimKey(guildId), viewer],
        queryFn: () => fetchHubClaim(guildId),
        enabled: enabled && guildId > 0,
        retry: retryUnlessClientError,
    });
}

export interface ClaimHubCandidateInput {
    readonly candidateId: string;
    /** Provider options from its options step; omitted when it has none. */
    readonly options?: Record<string, unknown>;
}

export type HubClaimedCallback = (result: HubClaimResult, qc: QueryClient) => void | Promise<void>;

/**
 * Refetch everything a claim changes: my characters, every public profile (its
 * character list, as the other character mutations do), the hub page (status
 * included), memberships.
 */
export async function invalidateAfterClaim(qc: QueryClient, guildId: number, result: HubClaimResult): Promise<void> {
    await Promise.all([
        qc.invalidateQueries({ queryKey: MY_CHARACTERS_KEY }),
        qc.invalidateQueries({ queryKey: ['userProfile'] }),
        qc.invalidateQueries({ queryKey: guildPageKey(guildId) }),
        ...(result.becameMember ? [invalidateAllHubMemberships(qc)] : []),
    ]);
}

/** Claim one candidate; `onClaimed` (the provider's) runs after core's invalidations. */
export function useClaimHubCandidate(
    guildId: number,
    onClaimed?: HubClaimedCallback,
): UseMutationResult<HubClaimResult, Error, ClaimHubCandidateInput> {
    const qc = useQueryClient();
    return useMutation<HubClaimResult, Error, ClaimHubCandidateInput>({
        mutationFn: ({ candidateId, options }) =>
            postHubClaim(guildId, candidateId, options === undefined ? {} : { options }),
        onSuccess: async (result) => {
            await invalidateAfterClaim(qc, guildId, result);
            if (onClaimed !== undefined) await onClaimed(result, qc);
        },
    });
}
