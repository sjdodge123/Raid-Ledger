/**
 * ROK-2056 — the ownership check for `registerHubCompanionPrompt`, in both
 * directions: every prompt names a setup requirement in ITS OWN plugin's
 * manifest that carries `rlCompanion` and stays inside that plugin's
 * `gameSlugs`; and every `rlCompanion` requirement is prompted by its plugin
 * (an unprompted one would be a Companion collector no member is told about).
 */
import type { PluginHubManifest } from '@raid-ledger/contract';
import { getHubCompanionPromptRegistrations } from '../components/hub/companion/hub-companion-prompts';

export interface CompanionPromptRegistration {
    owner: string;
    requirementId: string;
    games: readonly string[];
}

type Manifests = Readonly<Record<string, PluginHubManifest>>;

/** Every Companion prompt registered right now, with its owner. */
export function collectCompanionPrompts(): CompanionPromptRegistration[] {
    return getHubCompanionPromptRegistrations().map(({ pluginSlug, prompt }) => ({
        owner: pluginSlug, requirementId: prompt.requirementId, games: prompt.games,
    }));
}

function promptProblems(r: CompanionPromptRegistration, manifest: PluginHubManifest | undefined): string[] {
    const key = `companion prompt ${r.owner}:${r.requirementId}`;
    if (manifest === undefined) return [`${key} has no HUB_PLUGIN_MANIFESTS.${r.owner || '(no owner)'}`];
    const requirement = manifest.setup.requirements.find((q) => q.id === r.requirementId);
    if (requirement === undefined) return [`${key} names no requirement in HUB_PLUGIN_MANIFESTS.${r.owner}.setup`];
    const problems = requirement.rlCompanion === undefined ? [`${key} names a requirement without rlCompanion`] : [];
    if (r.games.length === 0) problems.push(`${key} lists no games`);
    const allowed = manifest.gameSlugs ?? [];
    return [...problems, ...r.games.filter((g) => !allowed.includes(g))
        .map((g) => `${key} targets game "${g}", not in HUB_PLUGIN_MANIFESTS.${r.owner}.gameSlugs`)];
}

/** Every drift between registered prompts and the manifests' `rlCompanion` requirements. */
export function companionPromptDrift(regs: readonly CompanionPromptRegistration[], manifests: Manifests): string[] {
    const byOwner = new Map(Object.entries(manifests));
    const prompted = new Set(regs.map((r) => `${r.owner}:${r.requirementId}`));
    const unprompted = [...byOwner].flatMap(([owner, m]) => m.setup.requirements
        .filter((q) => q.rlCompanion !== undefined && !prompted.has(`${owner}:${q.id}`))
        .map((q) => `HUB_PLUGIN_MANIFESTS.${owner}.setup requirement "${q.id}" carries rlCompanion but no companion prompt registers it`));
    return [...regs.flatMap((r) => promptProblems(r, byOwner.get(r.owner))), ...unprompted];
}
