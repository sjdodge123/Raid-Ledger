/**
 * ROK-1893 P1 — hub join prompts + the per-hub auto-membership setting.
 * `GET /users/me/hub-join-prompts`, `POST …/:id/accept`, `POST …/:id/dismiss`
 * (ruling §8d: `suggest` asks the person who signed up, `auto` tells them
 * once) and `PATCH /hubs/:id/auto-membership` (Leader or staff).
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import {
    HubInviteJoinResponseSchema, HubJoinPromptListSchema,
    type HubAutoMembershipMode, type HubInviteJoinResponse, type HubJoinPrompt, type HubJoinPromptList,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { toast } from '../../../lib/toast';
import { guildPageKey } from '../api/use-guild';
import { invalidateHubMembership } from './invalidate-hub-membership';

/** Query key of the signed-in user's pending hub join prompts. */
export const HUB_JOIN_PROMPTS_KEY = ['hub-join-prompts'] as const;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** The signed-in user's pending prompts; only fetched when `enabled` (signed in). */
export function useHubJoinPrompts(enabled: boolean): UseQueryResult<HubJoinPromptList, Error> {
    return useQuery({
        queryKey: HUB_JOIN_PROMPTS_KEY,
        queryFn: () => fetchApi('/users/me/hub-join-prompts', {}, HubJoinPromptListSchema),
        enabled,
    });
}

function dropPrompt(list: HubJoinPromptList | undefined, id: number): HubJoinPromptList | undefined {
    return list === undefined ? undefined : { items: list.items.filter((p) => p.id !== id) };
}

/** "Join hub" on a `suggest` prompt; the hub's membership surfaces refetch after. */
export function useAcceptHubJoinPrompt(): UseMutationResult<HubInviteJoinResponse, Error, HubJoinPrompt> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (p: HubJoinPrompt) =>
            fetchApi(`/users/me/hub-join-prompts/${p.id}/accept`, { method: 'POST' }, HubInviteJoinResponseSchema),
        onSuccess: async (res, p) => {
            toast.success(`Joined ${p.hubName}`);
            qc.setQueryData<HubJoinPromptList>(HUB_JOIN_PROMPTS_KEY, (old) => dropPrompt(old, p.id));
            await invalidateHubMembership(qc, res.hubId);
        },
        onError: (err) => { toast.error(err.message || 'Couldn’t join the hub. Try again.'); },
        onSettled: () => qc.invalidateQueries({ queryKey: HUB_JOIN_PROMPTS_KEY }),
    });
}

/** "Not now" on a `suggest` prompt, or closing the one-time `auto-joined` notice. */
export function useDismissHubJoinPrompt(): UseMutationResult<unknown, Error, HubJoinPrompt> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (p: HubJoinPrompt) => fetchApi(`/users/me/hub-join-prompts/${p.id}/dismiss`, { method: 'POST' }),
        onSuccess: (_res, p) => { qc.setQueryData<HubJoinPromptList>(HUB_JOIN_PROMPTS_KEY, (old) => dropPrompt(old, p.id)); },
        onError: (err) => { toast.error(err.message || 'Couldn’t dismiss that. Try again.'); },
        onSettled: () => qc.invalidateQueries({ queryKey: HUB_JOIN_PROMPTS_KEY }),
    });
}

/** The Leader's off / suggest / auto switch; the hub page refetches after. */
export function useHubAutoMembership(hubId: number): UseMutationResult<unknown, Error, HubAutoMembershipMode> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (mode: HubAutoMembershipMode) => fetchApi(`/hubs/${hubId}/auto-membership`, {
            method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ mode }),
        }),
        onSuccess: () => { toast.success('Membership setting saved'); },
        onError: (err) => { toast.error(err.message || 'Couldn’t save the membership setting. Try again.'); },
        onSettled: () => qc.invalidateQueries({ queryKey: guildPageKey(hubId) }),
    });
}
