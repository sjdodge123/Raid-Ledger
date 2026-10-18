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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HubOnboardingKey, HubOnboardingStateDto } from '@raid-ledger/contract';
import { useAuth, useViewerCacheScope } from '../../../hooks/use-auth';
import { dismissHubOnboarding, fetchHubOnboarding, type HubOnboardingScope } from './hub-onboarding-api';
import {
    mergePending, pairId, pendingLedger, type PendingDismissals,
} from './hub-onboarding-pending';

export const HUB_ONBOARDING_KEY_PREFIX = ['guilds', 'onboarding'] as const;

export function hubOnboardingKey(viewer: number | 'anon'): readonly unknown[] {
    return [...HUB_ONBOARDING_KEY_PREFIX, viewer] as const;
}

/**
 * The in-flight ledger rides in the same cache as the state, so it is scoped
 * to the QueryClient (and so to a test) without any module-level state. Its
 * own prefix keeps it clear of the state key's invalidations.
 */
export function hubOnboardingPendingKey(viewer: number | 'anon'): readonly unknown[] {
    return ['guilds', 'onboarding-pending', viewer] as const;
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
    const pendingKey = hubOnboardingPendingKey(viewer);
    const ledger = pendingLedger(
        () => queryClient.getQueryData<PendingDismissals>(pendingKey) ?? {},
        (map) => { queryClient.setQueryData(pendingKey, map); },
        pairId(key, guildId),
    );
    const mutation = useMutation<HubOnboardingStateDto, Error, void>({
        mutationFn: () => dismissHubOnboarding(key, guildId),
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<HubOnboardingStateDto>(queryKey);
            ledger.begin(isPromptDismissed(previous, key, guildId));
            queryClient.setQueryData(queryKey, withDismissal(previous, key, guildId, new Date().toISOString()));
        },
        // Rollback puts the prompt back rather than leaving it hidden on a
        // dismissal the server never stored — it would silently return on the
        // next page load with no explanation. `settlePending` decides: it
        // touches only THIS (key, guildId) entry, and only when no later write
        // for the pair confirmed it or is still running (Codex P2, PR-3).
        onError: () => {
            if (!ledger.settle('error')) return;
            queryClient.setQueryData<HubOnboardingStateDto>(
                queryKey, (cur) => withoutDismissal(cur, key, guildId),
            );
        },
        // Merge, don't replace: the response only knows about rows the server
        // had when it answered, so installing it wholesale drops a sibling
        // prompt's still-pending optimistic row (PR-3 review MINOR).
        onSuccess: (fresh) => {
            ledger.settle('success');
            const map = ledger.read();
            queryClient.setQueryData<HubOnboardingStateDto>(
                queryKey, (cur) => mergePending(fresh, cur, map),
            );
            // Nothing expires the confirmation here: a body can be older than
            // any number of later ones, so only a confirmed restore retires a
            // pair (Codex P2 r4).
        },
    });
    // Not memoized: `mutation` is a fresh object every render, so a
    // `useCallback` keyed on it memoized nothing (PR-3 nit).
    const dismiss = (): void => { mutation.mutate(); };
    const known = isAuthenticated && state.data !== undefined;
    return {
        visible: known && !isPromptDismissed(state.data, key, guildId),
        dismiss,
        failed: mutation.isError,
    };
}
