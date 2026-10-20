/**
 * ROK-1870 §2.3 — the community hub's membership routes (`/hubs/:id/…`).
 * Every write refetches every surface that shows membership
 * (`invalidateHubMembership`) so the hero, the Members tab, the nav, the game
 * card and the directory agree with the server.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { CommunityHubJoinResponseSchema, type CommunityHubJoinResponse } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { toast } from '../../../lib/toast';
import { invalidateHubMembership } from './invalidate-hub-membership';
import { hubBansKey } from './community-settings-api';

const base = (hubId: number): string => `/hubs/${hubId}`;

/** POST joins, DELETE leaves; both idempotent server-side. */
export function setCommunityJoined(hubId: number, joined: boolean): Promise<CommunityHubJoinResponse> {
    return fetchApi(`${base(hubId)}/join`, { method: joined ? 'POST' : 'DELETE' }, CommunityHubJoinResponseSchema);
}

function useRefresh(hubId: number): () => Promise<void> {
    const qc = useQueryClient();
    return () => invalidateHubMembership(qc, hubId);
}

/** Join (`true`) or Leave (`false`) this hub. */
export function useCommunityJoin(hubId: number): UseMutationResult<CommunityHubJoinResponse, Error, boolean> {
    const refresh = useRefresh(hubId);
    return useMutation({
        mutationFn: (joined: boolean) => setCommunityJoined(hubId, joined),
        onError: (err) => { toast.error(err.message || 'Couldn’t update your membership. Try again.'); },
        onSettled: refresh,
    });
}

/** One officer/leader action on a member row (§2.3). */
export type CommunityMemberCommand =
    | { kind: 'remove'; userId: number }
    | { kind: 'ban'; userId: number; reason?: string }
    | { kind: 'role'; userId: number; role: 'officer' | 'member' }
    | { kind: 'leader'; userId: number };

function sendCommand(hubId: number, cmd: CommunityMemberCommand): Promise<unknown> {
    const json = { 'Content-Type': 'application/json' };
    switch (cmd.kind) {
        case 'remove': return fetchApi(`${base(hubId)}/members/${cmd.userId}`, { method: 'DELETE' });
        case 'ban': return fetchApi(`${base(hubId)}/bans/${cmd.userId}`, { method: 'PUT', headers: json, body: JSON.stringify(cmd.reason ? { reason: cmd.reason } : {}) });
        case 'role': return fetchApi(`${base(hubId)}/members/${cmd.userId}/role`, { method: 'PATCH', headers: json, body: JSON.stringify({ role: cmd.role }) });
        case 'leader': return fetchApi(`${base(hubId)}/leader`, { method: 'POST', headers: json, body: JSON.stringify({ userId: cmd.userId }) });
    }
}

/** Remove / ban / promote / demote / hand over leadership; the page refetches after each. */
export function useCommunityMemberCommand(hubId: number): UseMutationResult<unknown, Error, CommunityMemberCommand> {
    const qc = useQueryClient();
    const refresh = useRefresh(hubId);
    return useMutation({
        mutationFn: (cmd: CommunityMemberCommand) => sendCommand(hubId, cmd),
        onError: (err) => { toast.error(err.message || 'That didn’t work. Try again.'); },
        // A ban also refreshes the Banned list, so a cached settings sheet shows the user at once.
        onSettled: async (_res, _err, cmd) => {
            await Promise.all([refresh(), cmd.kind === 'ban' ? qc.invalidateQueries({ queryKey: hubBansKey(hubId) }) : undefined]);
        },
    });
}
