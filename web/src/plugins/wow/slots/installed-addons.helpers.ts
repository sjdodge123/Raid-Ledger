/**
 * ROK-2147 — match a guild's recommended addons against the addon folders a
 * character's LedgerLink export reported. A recommendation matches by its
 * `folderName`, case-insensitive (operator Q3); one without a folder name
 * gets no state. Installed folders no recommendation claimed are "Also
 * installed", loaded first, then by name.
 */
import type { CharacterInstalledAddon } from '@raid-ledger/contract';
import type { AddonView } from '../guild/addon-view';

/** null = the recommendation has no folder name, so no Installed/Missing pill. */
export type InstallState = 'installed' | 'missing' | null;

export interface MatchedAddon { addon: AddonView; state: InstallState }

export interface InstalledMatch { rows: MatchedAddon[]; others: CharacterInstalledAddon[] }

function folderKey(name: string): string {
    return name.trim().toLowerCase();
}

function byLoadedThenName(a: CharacterInstalledAddon, b: CharacterInstalledAddon): number {
    if (a.loaded !== b.loaded) return a.loaded ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/** Each recommendation (order kept) with its state, plus the unmatched installed folders. */
export function matchInstalled(rows: readonly AddonView[], installed: readonly CharacterInstalledAddon[]): InstalledMatch {
    const present = new Set(installed.map((a) => folderKey(a.name)));
    const claimed = new Set<string>();
    const matched = rows.map((addon): MatchedAddon => {
        if (addon.folderName === null || folderKey(addon.folderName) === '') return { addon, state: null };
        const key = folderKey(addon.folderName);
        if (!present.has(key)) return { addon, state: 'missing' };
        claimed.add(key);
        return { addon, state: 'installed' };
    });
    const others = installed.filter((a) => !claimed.has(folderKey(a.name))).sort(byLoadedThenName);
    return { rows: matched, others };
}
