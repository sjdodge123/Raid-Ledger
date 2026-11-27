/**
 * ROK-2352 — the ownership check for `registerLfgGrouping`: every web grouping
 * is declared as an `lfg-grouping` behaviour of ITS OWN plugin's manifest and
 * lists at least one game. The manifest's `gameSlugs` is hub-widget scope only
 * (blizzard: Forever), so it is NOT a bound on a grouping's games. Both
 * directions: a declaration no web registration answers is drift too (AC12).
 */
import type { PluginHubManifest } from '@raid-ledger/contract';
import { getLfgGroupingRegistrations } from '../plugins/lfg-grouping';

export interface LfgGroupingOwnership {
    owner: string;
    id: string;
    gameSlugs: readonly string[];
}

type Manifests = Readonly<Record<string, PluginHubManifest>>;

/** Every grouping registered right now, with its owner. */
export function collectLfgGroupings(): LfgGroupingOwnership[] {
    return getLfgGroupingRegistrations().map(({ pluginSlug, grouping }) => ({
        owner: pluginSlug, id: grouping.id, gameSlugs: grouping.gameSlugs,
    }));
}

const declaredIds = (m: PluginHubManifest | undefined): string[] =>
    (m?.behaviours ?? []).filter((b) => b.kind === 'lfg-grouping').map((b) => b.id);

/** Problems for one registration; empty = owned and in scope. */
function problemsFor(r: LfgGroupingOwnership, manifest: PluginHubManifest | undefined): string[] {
    const problems: string[] = [];
    if (!declaredIds(manifest).includes(r.id)) {
        problems.push(`LFG grouping ${r.owner}:${r.id} is not declared as an lfg-grouping behaviour of HUB_PLUGIN_MANIFESTS.${r.owner}`);
    }
    if (r.gameSlugs.length === 0) problems.push(`LFG grouping ${r.owner}:${r.id} lists no games`);
    return problems;
}

/** Every problem across the registrations; empty = no drift. */
export function lfgGroupingDrift(regs: readonly LfgGroupingOwnership[], manifests: Manifests): string[] {
    const unregistered = Object.entries(manifests).flatMap(([owner, manifest]) =>
        declaredIds(manifest)
            .filter((id) => !regs.some((r) => r.owner === owner && r.id === id))
            .map((id) => `HUB_PLUGIN_MANIFESTS.${owner} declares lfg-grouping "${id}" but no web grouping registers it`));
    return [...regs.flatMap((r) => problemsFor(r, manifests[r.owner])), ...unregistered];
}
