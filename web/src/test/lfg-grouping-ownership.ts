/**
 * ROK-2352 — the ownership check for `registerLfgGrouping`: every web grouping
 * is declared as an `lfg-grouping` behaviour of ITS OWN plugin's manifest and
 * lists at least one game. The manifest's `gameSlugs` is hub-widget scope only
 * (blizzard: Forever), so it is NOT a bound on a grouping's games. (Declared-but-
 * unregistered is not checked yet: the WoW web registration lands with L9 — add
 * that direction there.)
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
    return regs.flatMap((r) => problemsFor(r, manifests[r.owner]));
}
