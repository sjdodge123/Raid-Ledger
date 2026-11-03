/**
 * ROK-1958 add-saves ruling (2026-10-29, Q1 = A): binding is per campaign key,
 * and one campaign key is one playthrough — so the Add my saves sheet lists
 * playthroughs, not single saves, and its button counts both.
 */
import { bg3LevelDisplay, type Bg3MySave } from '@raid-ledger/contract';
import { syncedAgo } from '../../../lib/synced-ago';

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

/** A save's area label alone ("Wilderness"), for telling apart same-named playthroughs. */
export const bg3AreaLabel = (save: Bg3MySave): string => bg3LevelDisplay(save.area).label;

/** "Act 2 · Shadow-Cursed Lands · 3 days ago" — a playthrough row's description tail. */
export function bg3SaveLine(save: Bg3MySave): string {
    const { act, label } = bg3LevelDisplay(save.area);
    return `${act === null ? label : `Act ${act} · ${label}`} · ${syncedAgo(save.savedAt)}`;
}

/** ROK-2068 — playthroughs whose newest save falls in one local calendar month. */
export interface Bg3MonthGroup {
    /** `YYYY-MM` (local), stable per month. */
    readonly key: string;
    /** "August 2024" in the viewer's locale. */
    readonly label: string;
    readonly playthroughs: readonly Bg3Playthrough[];
}

const MONTH_FORMAT: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };

/** The month heading for an ISO instant ("August 2024"), in the viewer's locale and time zone. */
export function bg3MonthLabel(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, MONTH_FORMAT);
}

function monthKey(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Group playthroughs by their newest save's local month; months newest first, rows newest first. */
export function groupByMonth(playthroughs: readonly Bg3Playthrough[]): Bg3MonthGroup[] {
    const byMonth = new Map<string, Bg3Playthrough[]>();
    const sorted = [...playthroughs].sort((a, b) => newestFirst(a.newest, b.newest));
    for (const p of sorted) {
        const key = monthKey(p.newest.savedAt);
        const group = byMonth.get(key);
        if (group) group.push(p); else byMonth.set(key, [p]);
    }
    return [...byMonth].map(([key, rows]) => ({ key, label: bg3MonthLabel(rows[0]?.newest.savedAt ?? ''), playthroughs: rows }));
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

/** ROK-2068 — Manage my saves' destructive button: "Remove 1 playthrough · 14 saves". */
export function removePlaythroughsLabel(playthroughs: number, saves: number, capped = false): string {
    const p = playthroughs === 1 ? '1 playthrough' : `${playthroughs} playthroughs`;
    return `Remove ${p} · ${saveCountLabel(saves, capped)}`;
}

/** ROK-2068 — the confirm step's title: "Remove 1 playthrough?". */
export function removePlaythroughsTitle(playthroughs: number): string {
    return `Remove ${playthroughs === 1 ? '1 playthrough' : `${playthroughs} playthroughs`}?`;
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

/** ROK-2068 — `on` adds every key of a month group to the picks, otherwise removes them all. */
export function setGroup(selected: ReadonlySet<string>, keys: readonly string[], on: boolean): Set<string> {
    const next = new Set(selected);
    for (const k of keys) if (on) next.add(k); else next.delete(k);
    return next;
}

/** ROK-2068 — a month's checkbox: all picked = checked, some = indeterminate, none = clear. */
export function groupState(selected: ReadonlySet<string>, keys: readonly string[]): { checked: boolean; indeterminate: boolean } {
    const picked = keys.filter((k) => selected.has(k)).length;
    return { checked: keys.length > 0 && picked === keys.length, indeterminate: picked > 0 && picked < keys.length };
}
