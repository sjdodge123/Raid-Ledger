/**
 * Pure draft logic for the Pelican connection form (ROK-121). The PUT body
 * carries only what changed: an untouched field is omitted, an explicit
 * removal is `''` (the server clears it).
 */
import type { PelicanConfig, PelicanConfigUpdate } from '@raid-ledger/contract';

export interface PelicanDraft {
    panelUrl: string;
    /** Typed replacement key; never prefilled from the server. */
    apiKey: string;
    /** The admin pressed "Remove saved secret" and has not saved yet. */
    removeKey: boolean;
}

export function draftFromConfig(config: PelicanConfig): PelicanDraft {
    return { panelUrl: config.panelUrl ?? '', apiKey: '', removeKey: false };
}

function apiKeyChange(draft: PelicanDraft): string | undefined {
    if (draft.removeKey) return '';
    const typed = draft.apiKey.trim();
    return typed === '' ? undefined : typed;
}

export function buildUpdateBody(draft: PelicanDraft, config: PelicanConfig): PelicanConfigUpdate {
    const panelUrl = draft.panelUrl.trim();
    const apiKey = apiKeyChange(draft);
    return {
        ...(panelUrl !== (config.panelUrl ?? '') ? { panelUrl } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
    };
}

export function isDirty(draft: PelicanDraft, config: PelicanConfig): boolean {
    return Object.keys(buildUpdateBody(draft, config)).length > 0;
}

/** Both a panel URL and a client key are stored (AC2). */
export function isPelicanConfigured(config: PelicanConfig): boolean {
    return !!config.panelUrl && config.apiKeySet;
}

/** Application keys (`papp_`) are refused by the server; the form warns as soon as one is typed. */
export function isApplicationKey(value: string): boolean {
    return value.trim().startsWith('papp_');
}
