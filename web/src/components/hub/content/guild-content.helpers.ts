/**
 * ROK-1786 — pure helpers for the guild page content (rules, links, addons,
 * the Resources tab rule).
 */
import type { GuildAddonFlavor, GuildAddonList, GuildProfile } from '@raid-ledger/contract';

/** A rule body renders as the prototype's item list: one item per non-blank line. */
export function ruleLines(body: string): string[] {
    return body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Resources hides only when it has nothing to show AND the viewer can't edit it. */
export function resourcesVisible(
    canEdit: boolean, profile: GuildProfile | undefined, addons: GuildAddonList | undefined,
): boolean {
    if (canEdit) return true;
    const count = (profile?.rules.length ?? 0) + (profile?.links.length ?? 0)
        + (addons?.pinned.length ?? 0) + (addons?.addons.length ?? 0);
    return count > 0;
}

/** Swap the item at `index` with its neighbour in `dir`; out of range = unchanged copy. */
export function moveItem<T>(list: readonly T[], index: number, dir: -1 | 1): T[] {
    const next = [...list];
    const to = index + dir;
    const a = next[index];
    const b = next[to];
    if (a === undefined || b === undefined) return next;
    next[index] = b;
    next[to] = a;
    return next;
}

export const FLAVOR_LABEL: Record<GuildAddonFlavor | 'any', string> = {
    any: 'Any flavor', classic: 'Classic', forever: 'Forever', retail: 'Retail',
};

export const SOURCE_LABEL = { curseforge: 'CurseForge', wago: 'Wago', github: 'GitHub', url: 'Website' } as const;

/** "Updated 3 Oct 2026" — absolute and locale-formatted, so tests stay stable. */
export function updatedLabel(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
