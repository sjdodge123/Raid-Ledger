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

function dismissPath(key: HubOnboardingKey, guildId: HubOnboardingScope): string {
    return `${BASE}/${key}/dismiss${guildId === null ? '' : `?guildId=${guildId}`}`;
}

export function fetchHubOnboarding(): Promise<HubOnboardingStateDto> {
    return fetchApi(BASE, {}, HubOnboardingStateSchema);
}

export function dismissHubOnboarding(key: HubOnboardingKey, guildId: HubOnboardingScope): Promise<HubOnboardingStateDto> {
    return fetchApi(dismissPath(key, guildId), { method: 'POST' }, HubOnboardingStateSchema);
}

/** Undo — kept because the prompts are the only way back once dismissed. */
export function restoreHubOnboarding(key: HubOnboardingKey, guildId: HubOnboardingScope): Promise<HubOnboardingStateDto> {
    return fetchApi(dismissPath(key, guildId), { method: 'DELETE' }, HubOnboardingStateSchema);
}
