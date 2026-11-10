/**
 * ROK-2153 — the ownership check for `registerHubClaimProvider`, in both
 * directions: every web claim provider belongs to a plugin whose manifest
 * declares a `claim-provider` behaviour (the same declaration the api guard
 * pins its `HUB_CLAIM_PROVIDER` adapter to) and stays inside that plugin's
 * `gameSlugs`; and every declared `claim-provider` has a web registration (an
 * api provider with no web half would be a claim path no member ever sees).
 */
import type { PluginHubManifest } from '@raid-ledger/contract';
import { getHubClaimProviderRegistrations } from '../components/hub/claim/hub-claim-providers';

export interface ClaimProviderRegistration {
    owner: string;
    games: readonly string[];
    kinds: readonly string[];
}

type Manifests = Readonly<Record<string, PluginHubManifest>>;

const CLAIM_KIND = 'claim-provider';

/** Every claim provider registered right now, with its owner. */
export function collectClaimProviders(): ClaimProviderRegistration[] {
    return getHubClaimProviderRegistrations().map(({ pluginSlug, provider }) => ({
        owner: pluginSlug, games: provider.games, kinds: provider.kinds,
    }));
}

function declaresClaimProvider(manifest: PluginHubManifest): boolean {
    return manifest.behaviours.some((b) => b.kind === CLAIM_KIND);
}

function providerProblems(r: ClaimProviderRegistration, manifest: PluginHubManifest | undefined): string[] {
    const key = `claim provider ${r.owner || '(no owner)'}`;
    if (manifest === undefined) return [`${key} has no HUB_PLUGIN_MANIFESTS.${r.owner || '(no owner)'}`];
    const problems = declaresClaimProvider(manifest) ? [] : [`${key} is registered but HUB_PLUGIN_MANIFESTS.${r.owner}.behaviours declares no ${CLAIM_KIND}`];
    if (r.games.length === 0) problems.push(`${key} lists no games`);
    if (r.kinds.length === 0) problems.push(`${key} lists no hub kinds`);
    const allowed = manifest.gameSlugs ?? [];
    return [...problems, ...r.games.filter((g) => !allowed.includes(g))
        .map((g) => `${key} targets game "${g}", not in HUB_PLUGIN_MANIFESTS.${r.owner}.gameSlugs`)];
}

/** Every drift between registered web claim providers and the manifests' `claim-provider` behaviours. */
export function claimProviderDrift(regs: readonly ClaimProviderRegistration[], manifests: Manifests): string[] {
    const byOwner = new Map(Object.entries(manifests));
    const registered = new Set(regs.map((r) => r.owner));
    const unregistered = [...byOwner]
        .filter(([owner, m]) => declaresClaimProvider(m) && !registered.has(owner))
        .map(([owner]) => `HUB_PLUGIN_MANIFESTS.${owner} declares a ${CLAIM_KIND} behaviour but no web claim provider registers it`);
    return [...regs.flatMap((r) => providerProblems(r, byOwner.get(r.owner))), ...unregistered];
}
