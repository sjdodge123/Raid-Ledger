/**
 * ROK-1969 — `PluginInfoDto` fixtures for the admin install sheet: the shipped
 * hub declarations (`HUB_PLUGIN_MANIFESTS`, parsed so every list is filled) with
 * `builtIn`, `hub` and `setupStatus`, so tests read the real manifests rather
 * than hand-written copies that drift.
 */
import {
    HUB_PLUGIN_MANIFESTS,
    PluginHubManifestSchema,
    emptyPluginHubManifest,
    type PluginInfoDto,
    type PluginSetupStatus,
} from '@raid-ledger/contract';

/** A non-built-in plugin with no hub contributions and no setup. */
export function makePluginInfo(overrides: Partial<PluginInfoDto> = {}): PluginInfoDto {
    return {
        slug: 'discord',
        name: 'Discord Authentication',
        version: '1.0.0',
        description: 'Discord OAuth2 authentication provider.',
        author: { name: 'Raid Ledger' },
        builtIn: false,
        hub: emptyPluginHubManifest(),
        gameSlugs: [],
        capabilities: ['auth-provider'],
        integrations: [],
        status: 'active',
        installedAt: '2026-10-01T00:00:00.000Z',
        ...overrides,
    };
}

/** The built-in Core plugin as the api serves it. */
export function corePluginInfo(): PluginInfoDto {
    return makePluginInfo({
        slug: 'core', name: 'Core', description: 'Built-in hub widgets and behaviours every hub can use.',
        builtIn: true, capabilities: [], hub: PluginHubManifestSchema.parse(HUB_PLUGIN_MANIFESTS.core),
        setupStatus: [],
    });
}

/** Valheim with its declared setup; `setupStatus` defaults to "nothing checked yet". */
export function valheimPluginInfo(setupStatus?: PluginSetupStatus[]): PluginInfoDto {
    const hub = PluginHubManifestSchema.parse(HUB_PLUGIN_MANIFESTS.valheim);
    const base = makePluginInfo({
        slug: 'valheim', name: 'Valheim', description: 'Valheim server presence, characters, map and planner.',
        gameSlugs: ['valheim'], capabilities: ['game-log-parser'], hub,
    });
    return setupStatus ? { ...base, setupStatus } : base;
}

/** Valheim: server bound, mod not uploading, token missing; optional rows unchecked. */
export const VALHEIM_TWO_LEFT: PluginSetupStatus[] = [
    { id: 'pelican-server', state: 'met', detail: 'Bound to the hub “Midgard Server”.' },
    { id: 'link-mod', state: 'unmet', detail: 'No upload yet' },
    { id: 'link-token', state: 'unmet', detail: 'No active token' },
    { id: 'item-catalogue-admin', state: 'unknown' },
    { id: 'player-steam-link', state: 'unknown' },
];
