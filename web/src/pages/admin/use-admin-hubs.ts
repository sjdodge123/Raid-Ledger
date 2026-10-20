/**
 * ROK-1870 — Admin → Hubs queue data: pending proposals, active/archived
 * community hubs, and the staff actions (approve, reject, create, transfer
 * leader, archive/restore). Every mutation invalidates the `['admin-hubs']`
 * prefix, so each tab's list (`['admin-hubs', tab]`) refetches.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import {
    AdminHubListSchema,
    type AdminCreateHubDto, type AdminHubList, type ApproveHubProposalDto, type GuildSummary,
    type HubProposalList, type HubStatusUpdateDto,
} from '@raid-ledger/contract';
import { getAuthToken } from '../../hooks/use-auth';
import { adminFetch } from '../../hooks/admin/admin-fetch';
import { invalidateHubMembership } from '../../components/hub/community/invalidate-hub-membership';

export type AdminHubTab = 'pending' | 'active' | 'archived';
export const ADMIN_HUBS_KEY = 'admin-hubs';

/** `GET /admin/hubs` row — the contract's `AdminHubEntry` (`leader: null` = leaderless). */
export type { AdminHubEntry } from '@raid-ledger/contract';

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

/** Pending proposals, oldest first. */
export function useAdminHubProposals(): UseQueryResult<HubProposalList> {
    return useQuery<HubProposalList>({
        queryKey: [ADMIN_HUBS_KEY, 'pending'],
        queryFn: () => adminFetch('/admin/hubs/proposals', undefined, 'Failed to load proposals'),
        enabled: !!getAuthToken(),
    });
}

/** Active or archived community hubs. */
export function useAdminHubList(status: 'active' | 'archived'): UseQueryResult<AdminHubList> {
    return useQuery<AdminHubList>({
        queryKey: [ADMIN_HUBS_KEY, status],
        queryFn: async () => AdminHubListSchema.parse(await adminFetch<unknown>(`/admin/hubs?status=${status}`, undefined, 'Failed to load hubs')),
        enabled: !!getAuthToken(),
    });
}

/** Builds a mutation that invalidates every admin-hubs tab (plus whatever `after` refreshes) on success. */
function useHubMutation<V, R = unknown>(
    fn: (vars: V) => Promise<R>, after?: (qc: QueryClient, vars: V) => Promise<void>,
): UseMutationResult<R, Error, V> {
    const qc = useQueryClient();
    return useMutation<R, Error, V>({
        mutationFn: fn,
        onSuccess: async (_res, vars) => {
            await Promise.all([qc.invalidateQueries({ queryKey: [ADMIN_HUBS_KEY] }), after?.(qc, vars)]);
        },
    });
}

/** Approve a proposal, optionally tidying its name/blurb. */
export function useApproveHubProposal(): UseMutationResult<GuildSummary, Error, { id: number; body: ApproveHubProposalDto }> {
    return useHubMutation(({ id, body }: { id: number; body: ApproveHubProposalDto }) =>
        adminFetch<GuildSummary>(`/admin/hubs/proposals/${id}/approve`, post(body), 'Failed to approve'));
}

/** Reject a proposal with a reason the proposer sees. */
export function useRejectHubProposal(): UseMutationResult<null, Error, { id: number; reason: string }> {
    return useHubMutation(({ id, reason }: { id: number; reason: string }) =>
        adminFetch<null>(`/admin/hubs/proposals/${id}/reject`, post({ reason }), 'Failed to reject').catch(rethrowUnlessEmpty));
}

/** Create an active hub directly with a chosen leader. */
export function useAdminCreateHub(): UseMutationResult<GuildSummary, Error, AdminCreateHubDto> {
    return useHubMutation((body: AdminCreateHubDto) =>
        adminFetch<GuildSummary>('/admin/hubs', post(body), 'Failed to create hub'));
}

/** Hand the hub's leadership to another user. */
export function useTransferHubLeader(): UseMutationResult<unknown, Error, { hubId: number; userId: number }> {
    return useHubMutation(({ hubId, userId }: { hubId: number; userId: number }) =>
        adminFetch<unknown>(`/hubs/${hubId}/leader`, post({ userId }), 'Failed to transfer leadership'));
}

/** Archive or restore a hub; the nav, game cards and directory drop / regain it too. */
export function useSetHubStatus(): UseMutationResult<unknown, Error, { hubId: number } & HubStatusUpdateDto> {
    return useHubMutation(({ hubId, status }: { hubId: number } & HubStatusUpdateDto) =>
        adminFetch<unknown>(`/hubs/${hubId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, 'Failed to update hub'),
    (qc, { hubId }) => invalidateHubMembership(qc, hubId));
}

/** A 204 has no JSON body — `adminFetch`'s parse fails after an ok response; treat that as success. */
function rethrowUnlessEmpty(err: unknown): null {
    if (err instanceof SyntaxError) return null;
    throw err;
}
