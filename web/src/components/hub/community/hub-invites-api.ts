/**
 * ROK-1893 P1 — community-hub invite links: the member's list / create /
 * revoke (`/hubs/:id/invites`), the public preview and the redeem
 * (`/hubs/invites/:token[/join]`). A redeem refetches every membership
 * surface (`invalidateHubMembership`) so the hub page shows the new member.
 */
import {
    useMutation, useQuery, useQueryClient,
    type UseMutationResult, type UseQueryResult,
} from '@tanstack/react-query';
import {
    HubInviteJoinResponseSchema, HubInviteListSchema, HubInvitePreviewSchema, HubInviteSchema,
    type CreateHubInviteDto, type HubInvite, type HubInviteJoinResponse, type HubInviteList, type HubInvitePreview,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { toast } from '../../../lib/toast';
import { invalidateHubMembership } from './invalidate-hub-membership';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const hubInvitesKey = (hubId: number): readonly unknown[] => ['hubs', hubId, 'invites'];
export const hubInvitePreviewKey = (token: string): readonly unknown[] => ['hubs', 'invites', 'preview', token];

export function getHubInvites(hubId: number): Promise<HubInviteList> {
    return fetchApi(`/hubs/${hubId}/invites`, {}, HubInviteListSchema);
}

export function createHubInvite(hubId: number, dto: CreateHubInviteDto): Promise<HubInvite> {
    return fetchApi(`/hubs/${hubId}/invites`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(dto) }, HubInviteSchema);
}

export function revokeHubInvite(hubId: number, inviteId: number): Promise<unknown> {
    return fetchApi(`/hubs/${hubId}/invites/${inviteId}`, { method: 'DELETE' });
}

export function getHubInvitePreview(token: string): Promise<HubInvitePreview> {
    return fetchApi(`/hubs/invites/${encodeURIComponent(token)}`, {}, HubInvitePreviewSchema);
}

export function joinHubInvite(token: string): Promise<HubInviteJoinResponse> {
    return fetchApi(`/hubs/invites/${encodeURIComponent(token)}/join`, { method: 'POST' }, HubInviteJoinResponseSchema);
}

/** The viewer's links (a member) or every link (Leader/Officer/staff). */
export function useHubInvites(hubId: number, enabled = true): UseQueryResult<HubInviteList, Error> {
    return useQuery({ queryKey: hubInvitesKey(hubId), queryFn: () => getHubInvites(hubId), enabled });
}

export function useCreateHubInvite(hubId: number): UseMutationResult<HubInvite, Error, CreateHubInviteDto> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (dto: CreateHubInviteDto) => createHubInvite(hubId, dto),
        onError: (err) => { toast.error(err.message || 'Couldn’t make an invite link. Try again.'); },
        onSettled: () => qc.invalidateQueries({ queryKey: hubInvitesKey(hubId) }),
    });
}

export function useRevokeHubInvite(hubId: number): UseMutationResult<unknown, Error, number> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (inviteId: number) => revokeHubInvite(hubId, inviteId),
        onError: (err) => { toast.error(err.message || 'Couldn’t revoke that link. Try again.'); },
        onSettled: () => qc.invalidateQueries({ queryKey: hubInvitesKey(hubId) }),
    });
}

/** Public preview for `/h/:token`; a 404 (malformed / unknown token) is not retried. */
export function useHubInvitePreview(token: string): UseQueryResult<HubInvitePreview, Error> {
    return useQuery({ queryKey: hubInvitePreviewKey(token), queryFn: () => getHubInvitePreview(token), retry: false });
}

/** Redeem a link for the signed-in viewer. */
export function useJoinHubInvite(): UseMutationResult<HubInviteJoinResponse, Error, string> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (token: string) => joinHubInvite(token),
        onSuccess: (res) => invalidateHubMembership(qc, res.hubId),
    });
}
