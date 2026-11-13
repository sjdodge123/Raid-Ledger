/**
 * ROK-2187 — the ownership check for `registerGgCard`, both ways: every web GG
 * card renderer is declared as a `gg-card` behaviour of ITS OWN plugin's
 * manifest (the api guard pins the producer to the same declaration), and every
 * declared `gg-card` has a renderer — otherwise its stored card is silently
 * skipped in every player's story.
 */
import type { PluginHubManifest } from '@raid-ledger/contract';
import { getGgCardRegistrations } from '../plugins/gg-cards';

export interface GgCardOwnership {
    owner: string;
    id: string;
}

type Manifests = Readonly<Record<string, PluginHubManifest>>;

/** Every GG card renderer registered right now, with its owner. */
export function collectGgCards(): GgCardOwnership[] {
    return getGgCardRegistrations().map(({ pluginSlug, card }) => ({ owner: pluginSlug, id: card.id }));
}

const declaredIds = (m: PluginHubManifest | undefined): string[] =>
    (m?.behaviours ?? []).filter((b) => b.kind === 'gg-card').map((b) => b.id);

/** Problems in both directions; empty = no drift. */
export function ggCardDrift(regs: readonly GgCardOwnership[], manifests: Manifests): string[] {
    const problems: string[] = [];
    for (const r of regs) {
        if (!declaredIds(manifests[r.owner]).includes(r.id)) {
            problems.push(`GG card ${r.owner}:${r.id} is not declared as a gg-card behaviour of HUB_PLUGIN_MANIFESTS.${r.owner}`);
        }
    }
    for (const [owner, manifest] of Object.entries(manifests)) {
        for (const id of declaredIds(manifest)) {
            if (!regs.some((r) => r.owner === owner && r.id === id)) {
                problems.push(`HUB_PLUGIN_MANIFESTS.${owner} declares gg-card "${id}" but no web renderer registers it`);
            }
        }
    }
    return problems;
}
