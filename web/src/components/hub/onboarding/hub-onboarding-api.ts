/**
 * ROK-1830 S5 — the onboarding-prompt dismissal API (`/guilds/onboarding`).
 * All three routes answer with the caller's WHOLE dismissal state, so the web
 * replaces its cache instead of merging a partial response into it.
 */
import type { HubOnboardingKey, HubOnboardingStateDto } from '@raid-ledger/contract';
import { HubOnboardingStateSchema } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

const BASE = '/guilds/onboarding';

/** `null` = the global scope (the Players card); a number scopes to one hub. */
export type HubOnboardingScope = number | null;

/**
 * ROK-2153 N4 — a provider's dismissal round (BG3: the campaign), sent only
 * with a hub id; `null` = once per scope, today's behaviour.
 */
export type HubOnboardingDismissScope = string | null;

function dismissPath(key: HubOnboardingKey, guildId: HubOnboardingScope, scope: HubOnboardingDismissScope): string {
    if (guildId === null) return `${BASE}/${key}/dismiss`;
    const round = scope === null ? '' : `&scope=${encodeURIComponent(scope)}`;
    return `${BASE}/${key}/dismiss?guildId=${guildId}${round}`;
}

export function fetchHubOnboarding(): Promise<HubOnboardingStateDto> {
    return fetchApi(BASE, {}, HubOnboardingStateSchema);
}

export function dismissHubOnboarding(
    key: HubOnboardingKey, guildId: HubOnboardingScope, scope: HubOnboardingDismissScope = null,
): Promise<HubOnboardingStateDto> {
    return fetchApi(dismissPath(key, guildId, scope), { method: 'POST' }, HubOnboardingStateSchema);
}

/** Undo — kept because the prompts are the only way back once dismissed. */
export function restoreHubOnboarding(
    key: HubOnboardingKey, guildId: HubOnboardingScope, scope: HubOnboardingDismissScope = null,
): Promise<HubOnboardingStateDto> {
    return fetchApi(dismissPath(key, guildId, scope), { method: 'DELETE' }, HubOnboardingStateSchema);
}
