/**
 * ROK-1786 — one view model for pinned and guild addon rows, and the flavor
 * filter (`null` flavor / empty `flavors` = every flavor).
 */
import type { GuildAddon, GuildAddonFlavor, GuildAddonRequirement, PinnedAddon } from '@raid-ledger/contract';
import { FLAVOR_LABEL, SOURCE_LABEL } from './guild-content.helpers';
import { parseAddonUrl } from './addon-url';

export type FlavorFilter = GuildAddonFlavor | 'any';

export interface AddonView {
    key: string;
    /** Guild addon id; null on a pinned row. */
    id: number | null;
    name: string;
    url: string;
    note: string | null;
    required: boolean;
    source: string;
    flavorLabel: string;
}

export interface AddonDetails { note: string; requirement: GuildAddonRequirement; flavor: GuildAddonFlavor | null }

export function guildAddonView(a: GuildAddon): AddonView {
    return {
        key: `g-${a.id}`, id: a.id, name: a.displayName, url: a.url, note: a.note, required: a.requirement === 'required',
        source: SOURCE_LABEL[a.source], flavorLabel: FLAVOR_LABEL[a.flavor ?? 'any'],
    };
}

export function pinnedAddonView(p: PinnedAddon, i: number): AddonView {
    const source = parseAddonUrl(p.url)?.source ?? 'url';
    const flavorLabel = p.flavors.length === 0 ? FLAVOR_LABEL.any : p.flavors.map((f) => FLAVOR_LABEL[f]).join(' · ');
    return {
        key: `p-${i}`, id: null, name: p.name, url: p.url, note: p.note, required: p.requirement === 'required',
        source: SOURCE_LABEL[source], flavorLabel,
    };
}

export function guildAddonMatches(a: GuildAddon, filter: FlavorFilter): boolean {
    return filter === 'any' || a.flavor === null || a.flavor === filter;
}

export function pinnedMatches(p: PinnedAddon, filter: FlavorFilter): boolean {
    return filter === 'any' || p.flavors.length === 0 || p.flavors.includes(filter);
}

/** The full id list after swapping `id` with its nearest neighbour visible under the filter. */
export function reorderedIds(all: readonly GuildAddon[], id: number, dir: -1 | 1, visible: ReadonlySet<number>): number[] | null {
    const ids = all.map((a) => a.id);
    const from = ids.indexOf(id);
    let to = from + dir;
    while (to >= 0 && to < ids.length && !visible.has(ids[to] ?? -1)) to += dir;
    const a = ids[from];
    const b = ids[to];
    if (from < 0 || a === undefined || b === undefined) return null;
    ids[from] = b;
    ids[to] = a;
    return ids;
}
