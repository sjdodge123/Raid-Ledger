/**
 * ROK-1830 S5 — `useHubOnboarding(key, guildId)`: is this prompt still worth
 * showing, and how do I dismiss it?
 *
 * One query holds every dismissal the viewer has (the payload is a handful of
 * rows), so a page with two prompts makes one request. The key ends in the
 * viewer scope (ROK-1314) — dismissals are per user, and a shared key would
 * keep the previous viewer's answers after a sign-out + sign-in.
 *
 * `visible` is false until the state is known: a prompt that flashes in and
 * then disappears because the server already had the dismissal is worse than
 * one that appears a beat late.
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HubOnboardingKey, HubOnboardingStateDto } from '@raid-ledger/contract';
import { useAuth, useViewerCacheScope } from '../../../hooks/use-auth';
import { dismissHubOnboarding, fetchHubOnboarding, type HubOnboardingScope } from './hub-onboarding-api';

export const HUB_ONBOARDING_KEY_PREFIX = ['guilds', 'onboarding'] as const;

export function hubOnboardingKey(viewer: number | 'anon'): readonly unknown[] {
    return [...HUB_ONBOARDING_KEY_PREFIX, viewer] as const;
}

/** Pure: does this state already hold a dismissal for exactly this scope? */
export function isPromptDismissed(
    state: HubOnboardingStateDto | undefined, key: HubOnboardingKey, guildId: HubOnboardingScope,
): boolean {
    return (state?.dismissed ?? []).some((d) => d.key === key && d.guildId === guildId);
}

/** The state with this dismissal removed — the rollback of one optimistic add. */
export function withoutDismissal(
    state: HubOnboardingStateDto | undefined, key: HubOnboardingKey, guildId: HubOnboardingScope,
): HubOnboardingStateDto {
    return { dismissed: (state?.dismissed ?? []).filter((d) => !(d.key === key && d.guildId === guildId)) };
}

/** The state with this dismissal added — what the optimistic update writes. */
export function withDismissal(
    state: HubOnboardingStateDto | undefined, key: HubOnboardingKey, guildId: HubOnboardingScope, at: string,
): HubOnboardingStateDto {
    const current = state?.dismissed ?? [];
    if (isPromptDismissed(state, key, guildId)) return { dismissed: [...current] };
    return { dismissed: [...current, { key, guildId, dismissedAt: at }] };
}

export interface HubOnboardingPrompt {
    /** Signed in, state known, and not dismissed for this scope. */
    visible: boolean;
    /** Optimistic — the prompt goes the moment this is called, and comes back if the write fails. */
    dismiss: () => void;
    /** The last dismiss failed; the prompt is back on screen. */
    failed: boolean;
}

export function useHubOnboarding(key: HubOnboardingKey, guildId: HubOnboardingScope = null): HubOnboardingPrompt {
    const { isAuthenticated } = useAuth();
    const viewer = useViewerCacheScope();
    const queryClient = useQueryClient();
    const queryKey = hubOnboardingKey(viewer);
    const state = useQuery({
        queryKey,
        queryFn: fetchHubOnboarding,
        enabled: isAuthenticated,
        retry: false,
    });
    const mutation = useMutation<HubOnboardingStateDto, Error, void, { added: boolean }>({
        mutationFn: () => dismissHubOnboarding(key, guildId),
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<HubOnboardingStateDto>(queryKey);
            const added = !isPromptDismissed(previous, key, guildId);
            queryClient.setQueryData(queryKey, withDismissal(previous, key, guildId, new Date().toISOString()));
            return { added };
        },
        // Rollback puts the prompt back rather than leaving it hidden on a
        // dismissal the server never stored — it would silently return on the
        // next page load with no explanation. It reconciles only THIS (key,
        // guildId) entry: restoring the whole snapshot would also undo a
        // sibling prompt's dismissal that succeeded while this one was in
        // flight (Codex P2, PR-3).
        onError: (_e, _v, ctx) => {
            if (ctx?.added !== true) return;
            queryClient.setQueryData<HubOnboardingStateDto>(
                queryKey, (cur) => withoutDismissal(cur, key, guildId),
            );
        },
        onSuccess: (fresh) => { queryClient.setQueryData(queryKey, fresh); },
    });
    const dismiss = useCallback(() => { mutation.mutate(); }, [mutation.mutate]);
    const known = isAuthenticated && state.data !== undefined;
    return {
        visible: known && !isPromptDismissed(state.data, key, guildId),
        dismiss,
        failed: mutation.isError,
    };
}
