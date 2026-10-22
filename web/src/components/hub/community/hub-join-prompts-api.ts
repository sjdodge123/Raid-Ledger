/**
 * ROK-1893 P1 — hub join prompts + the per-hub auto-membership setting.
 * `GET /users/me/hub-join-prompts`, `POST …/:id/accept`, `POST …/:id/dismiss`
 * (ruling §8d: `suggest` asks the person who signed up, `auto` tells them
 * once) and `PATCH /hubs/:id/auto-membership` (Leader or staff).
 */
import {
    useMutation, useQuery, useQueryClient, type QueryClient, type UseMutationResult, type UseQueryResult,
} from '@tanstack/react-query';
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

/** Poll cadence + window after a signup: the API raises prompts in a post-commit listener. */
export const PROMPT_POLL_MS = 1_000;
export const PROMPT_WATCH_MS = 8_000;

const promptWatchKey = (eventId: number) => ['hub-join-prompts-watch', eventId] as const;

/** Open the bounded post-signup watch for `eventId`'s prompt (called on signup success). */
export function watchHubJoinPrompts(qc: QueryClient, eventId: number): void {
    qc.setQueryData<number>(promptWatchKey(eventId), Date.now() + PROMPT_WATCH_MS);
}

/** Poll while the watch is open and no signup prompt for `eventId` has arrived yet. */
export function promptPollInterval(
    deadline: number | undefined, data: HubJoinPromptList | undefined, eventId: number, now: number,
): number | false {
    if (deadline === undefined || now >= deadline) return false;
    const arrived = (data?.items ?? []).some((p) => p.source === 'signup' && p.sourceRef === eventId);
    return arrived ? false : PROMPT_POLL_MS;
}

/**
 * The signed-in user's pending prompts; only fetched when `enabled` (signed in).
 * `watchEventId` (a hub-tagged event's page) polls briefly after a signup there.
 */
export function useHubJoinPrompts(enabled: boolean, watchEventId?: number): UseQueryResult<HubJoinPromptList, Error> {
    const qc = useQueryClient();
    return useQuery({
        queryKey: HUB_JOIN_PROMPTS_KEY,
        queryFn: () => fetchApi('/users/me/hub-join-prompts', {}, HubJoinPromptListSchema),
        enabled,
        refetchInterval: (query) => (watchEventId === undefined ? false : promptPollInterval(
            qc.getQueryData<number>(promptWatchKey(watchEventId)), query.state.data, watchEventId, Date.now(),
        )),
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
