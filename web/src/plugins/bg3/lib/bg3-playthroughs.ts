/**
 * ROK-1958 add-saves ruling (2026-10-29, Q1 = A): binding is per campaign key,
 * and one campaign key is one playthrough — so the Add my saves sheet lists
 * playthroughs, not single saves, and its button counts both.
 */
import type { Bg3MySave } from '@raid-ledger/contract';

/** One playthrough: every listed save sharing a campaign key, newest first. */
export interface Bg3Playthrough {
    readonly campaignKey: string;
    readonly saves: readonly Bg3MySave[];
    readonly newest: Bg3MySave;
}

const newestFirst = (a: Bg3MySave, b: Bg3MySave): number => b.savedAt.localeCompare(a.savedAt);

/** Group saves by campaign key; playthroughs ordered by their newest save. */
export function groupByPlaythrough(saves: readonly Bg3MySave[]): Bg3Playthrough[] {
    const byKey = new Map<string, Bg3MySave[]>();
    for (const save of saves) {
        const group = byKey.get(save.campaignKey);
        if (group) group.push(save); else byKey.set(save.campaignKey, [save]);
    }
    const groups: Bg3Playthrough[] = [];
    for (const [campaignKey, group] of byKey) {
        const sorted = [...group].sort(newestFirst);
        const [newest] = sorted;
        if (newest) groups.push({ campaignKey, saves: sorted, newest });
    }
    return groups.sort((a, b) => newestFirst(a.newest, b.newest));
}

/** "1 save" / "14 saves"; `capped` (the page walk hit its safety stop) ⇒ "40+ saves". */
export function saveCountLabel(n: number, capped = false): string {
    if (capped) return `${n}+ saves`;
    return n === 1 ? '1 save' : `${n} saves`;
}

/** The sheet's submit button: "Add 1 playthrough · 14 saves" ("14+ saves" when capped). */
export function addPlaythroughsLabel(playthroughs: number, saves: number, capped = false): string {
    const p = playthroughs === 1 ? '1 playthrough' : `${playthroughs} playthroughs`;
    return `Add ${p} · ${saveCountLabel(saves, capped)}`;
}

/**
 * The client only lists unfiled saves, so it can't tell whether a ticked
 * playthrough also has saves in another campaign — this note covers that case.
 */
export function addSavesMoveNote(ticked: number): string {
    const which = ticked > 1 ? 'these playthroughs' : 'this playthrough';
    return `Saves from ${which} already in another campaign move here too.`;
}

function clashing(labels: readonly string[]): Set<string> {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const l of labels) {
        if (seen.has(l)) dup.add(l); else seen.add(l);
    }
    return dup;
}

/**
 * One unique checkbox label per playthrough (same order): the newest save's
 * name; on a clash, plus `detail(newest)` (e.g. the area); on a further
 * clash, numbered "(1)", "(2)" so no two checkboxes share an accessible name.
 */
export function uniquePlaythroughLabels(
    playthroughs: readonly Bg3Playthrough[],
    detail: (save: Bg3MySave) => string,
): string[] {
    const names = playthroughs.map((p) => p.newest.saveName);
    const nameClash = clashing(names);
    const detailed = playthroughs.map((p) => (nameClash.has(p.newest.saveName) ? `${p.newest.saveName} · ${detail(p.newest)}` : p.newest.saveName));
    const stillClash = clashing(detailed);
    const counts = new Map<string, number>();
    return detailed.map((label) => {
        if (!stillClash.has(label)) return label;
        const n = (counts.get(label) ?? 0) + 1;
        counts.set(label, n);
        return `${label} (${n})`;
    });
}
