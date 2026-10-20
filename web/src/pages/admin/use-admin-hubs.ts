/**
 * ROK-1870 — Admin → Hubs queue data: pending proposals, active/archived
 * community hubs, and the staff actions (approve, reject, create, transfer
 * leader, archive/restore). Every mutation invalidates the `['admin-hubs']`
 * prefix, so each tab's list (`['admin-hubs', tab]`) refetches.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type {
    AdminCreateHubDto, ApproveHubProposalDto, GuildSummary, HubDirectoryEntry,
    HubProposalList, HubStatusUpdateDto,
} from '@raid-ledger/contract';
import { getAuthToken } from '../../hooks/use-auth';
import { adminFetch } from '../../hooks/admin/admin-fetch';

export type AdminHubTab = 'pending' | 'active' | 'archived';
export const ADMIN_HUBS_KEY = 'admin-hubs';

/** `GET /admin/hubs` row — a directory entry plus the admin-only `leaderless` flag. */
export type AdminHubEntry = HubDirectoryEntry & { leaderless?: boolean; createdAt?: string };

export interface AdminHubPage {
    items: AdminHubEntry[];
    nextCursor: string | null;
    total: number;
}

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
export function useAdminHubList(status: 'active' | 'archived'): UseQueryResult<AdminHubPage> {
    return useQuery<AdminHubPage>({
        queryKey: [ADMIN_HUBS_KEY, status],
        queryFn: () => adminFetch(`/admin/hubs?status=${status}`, undefined, 'Failed to load hubs'),
        enabled: !!getAuthToken(),
    });
}

/** Builds a mutation that invalidates every admin-hubs tab on success. */
function useHubMutation<V, R = unknown>(fn: (vars: V) => Promise<R>): UseMutationResult<R, Error, V> {
    const qc = useQueryClient();
    return useMutation<R, Error, V>({
        mutationFn: fn,
        onSuccess: () => qc.invalidateQueries({ queryKey: [ADMIN_HUBS_KEY] }),
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

/** Archive or restore a hub. */
export function useSetHubStatus(): UseMutationResult<unknown, Error, { hubId: number } & HubStatusUpdateDto> {
    return useHubMutation(({ hubId, status }: { hubId: number } & HubStatusUpdateDto) =>
        adminFetch<unknown>(`/hubs/${hubId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, 'Failed to update hub'));
}

/** A 204 has no JSON body — `adminFetch`'s parse fails after an ok response; treat that as success. */
function rethrowUnlessEmpty(err: unknown): null {
    if (err instanceof SyntaxError) return null;
    throw err;
}
