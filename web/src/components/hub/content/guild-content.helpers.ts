/**
 * ROK-1786/ROK-1830 — pure helpers for the hub's core content (rules, links
 * and the Resources tab rule). The addon flavor labels moved to the WoW
 * plugin with the addon panel they name.
 */
import type { GuildProfile } from '@raid-ledger/contract';

/** A rule body renders as the prototype's item list: one item per non-blank line. */
export function ruleLines(body: string): string[] {
    return body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * Core's half of the Resources rule: it hides only when core's own content is
 * empty AND the viewer can't edit it. Module sections answer separately
 * through `HubModSource.useVisible` (ROK-1830) and are OR-ed in by the
 * caller, which keeps the pre-r2 truth table: canEdit OR rules+links+<module
 * content> > 0.
 */
export function resourcesVisible(canEdit: boolean, profile: GuildProfile | undefined): boolean {
    if (canEdit) return true;
    return (profile?.rules.length ?? 0) + (profile?.links.length ?? 0) > 0;
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

/** "Updated 3 Oct 2026" — absolute and locale-formatted, so tests stay stable. */
export function updatedLabel(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
