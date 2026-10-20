/**
 * ROK-1870 §2.3 — the settings-sheet routes of a community hub: the Banned
 * list (`GET|DELETE /hubs/:id/bans[/:userId]`) and the lifecycle switch
 * (`PATCH /hubs/:id/status` — the Leader archives, staff restore), and the
 * blurb (`PATCH /hubs/:id`).
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { HubBanListSchema, type HubBanList, type HubBlurbUpdateDto, type HubStatusUpdateDto } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { toast } from '../../../lib/toast';
import { invalidateHubMembership } from './invalidate-hub-membership';

/** Query key of one hub's Banned list. */
export const hubBansKey = (hubId: number): readonly [string, number, string] => ['community-hub', hubId, 'bans'];

/** The hub's banned users; only fetched for viewers who may edit the hub. */
export function useHubBans(hubId: number, enabled: boolean): UseQueryResult<HubBanList, Error> {
    return useQuery({
        queryKey: hubBansKey(hubId),
        queryFn: () => fetchApi(`/hubs/${hubId}/bans`, {}, HubBanListSchema),
        enabled,
    });
}

/** Lift one ban; the list refetches after. */
export function useHubUnban(hubId: number): UseMutationResult<unknown, Error, number> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (userId: number) => fetchApi(`/hubs/${hubId}/bans/${userId}`, { method: 'DELETE' }),
        onSuccess: () => { toast.success('Unbanned'); },
        onError: (err) => { toast.error(err.message || 'Couldn’t lift the ban. Try again.'); },
        onSettled: () => qc.invalidateQueries({ queryKey: hubBansKey(hubId) }),
    });
}

/** Save the hub's blurb (`PATCH /hubs/:id`, `null` clears it); the page, nav, game cards and directory refetch after. */
export function useHubBlurb(hubId: number): UseMutationResult<unknown, Error, HubBlurbUpdateDto['blurb']> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (blurb: HubBlurbUpdateDto['blurb']) => fetchApi(`/hubs/${hubId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blurb }),
        }),
        onSuccess: () => { toast.success('Description saved'); },
        onError: (err) => { toast.error(err.message || 'Couldn’t save the description. Try again.'); },
        onSettled: () => invalidateHubMembership(qc, hubId),
    });
}

/** Archive (`'archived'`) or restore (`'active'`) the hub; the page, nav, game cards and directory refetch after. */
export function useHubStatus(hubId: number): UseMutationResult<unknown, Error, HubStatusUpdateDto['status']> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (status: HubStatusUpdateDto['status']) => fetchApi(`/hubs/${hubId}/status`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
        }),
        onSuccess: (_data, status) => { toast.success(status === 'archived' ? 'Hub archived' : 'Hub restored'); },
        onError: (err) => { toast.error(err.message || 'Couldn’t change the hub’s status. Try again.'); },
        onSettled: () => invalidateHubMembership(qc, hubId),
    });
}
