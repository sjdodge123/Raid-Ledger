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

/** "1 save" / "14 saves". */
export function saveCountLabel(n: number): string {
    return n === 1 ? '1 save' : `${n} saves`;
}

/** The sheet's submit button: "Add 1 playthrough · 14 saves". */
export function addPlaythroughsLabel(playthroughs: number, saves: number): string {
    const p = playthroughs === 1 ? '1 playthrough' : `${playthroughs} playthroughs`;
    return `Add ${p} · ${saveCountLabel(saves)}`;
}
