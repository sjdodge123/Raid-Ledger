/**
 * ROK-2153 N4 — whether the claim prompt was dismissed, and its status.
 *
 * Unscoped provider (Valheim, WoW): today's order — the onboarding state
 * first, the status GET only when the prompt is not dismissed for the hub.
 * Scoped provider (`scopedDismissal`, BG3): the status first, because it
 * carries the round (`dismissScope`) a dismissal must match; a scoped
 * provider that reports no scope matches unscoped dismissals.
 *
 * The hooks run in one fixed order either way; only `enabled` and the scope
 * differ. The shared state query adds no request.
 */
import type { HubClaimStatus } from '@raid-ledger/contract';
import { useAuth } from '../../../hooks/use-auth';
import { isPromptDismissed, useHubOnboarding, useHubOnboardingState, type HubOnboardingPrompt } from '../onboarding/use-hub-onboarding';
import type { HubClaimProviderRegistration } from './hub-claim-providers';
import { useHubClaim } from './use-hub-claim';

export interface ClaimDismissal {
    prompt: HubOnboardingPrompt;
    status: HubClaimStatus | undefined;
    isError: boolean;
}

export function useClaimDismissal(guildId: number, registration: HubClaimProviderRegistration): ClaimDismissal {
    const { isAuthenticated } = useAuth();
    const scoped = registration.provider.scopedDismissal === true;
    const state = useHubOnboardingState();
    const unscopedVisible = isAuthenticated && state.data !== undefined
        && !isPromptDismissed(state.data, 'claim-character', guildId);
    const claim = useHubClaim(guildId, scoped ? isAuthenticated : unscopedVisible);
    const scope = scoped ? claim.data?.dismissScope ?? null : null;
    const base = useHubOnboarding('claim-character', guildId, scope);
    if (!scoped) return { prompt: base, status: claim.data, isError: claim.isError };
    // Scoped: a dismissal cannot be judged before the status names the round.
    const known = claim.data !== undefined;
    const prompt = { ...base, visible: base.visible && known, settled: base.settled && (known || claim.isError || !isAuthenticated || guildId <= 0) };
    return { prompt, status: claim.data, isError: claim.isError };
}
