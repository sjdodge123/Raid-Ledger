/** ROK-1853 — pure helpers for the Materials tab: grouping, search, sort, labels. */
import type {
    ValheimMapBaseMap,
    ValheimMaterialStack,
} from '@raid-ledger/contract';
import type { ValheimContainerSummary } from '@raid-ledger/contract';
import {
    resolveItem,
    type ValheimItemCatalogue,
} from '../character/item-icon.helpers';

export interface MaterialsFilters {
    search: string;
    category: string | null;
    includeVehicles: boolean;
}

/** D10: vehicles are counted by default. */
export const DEFAULT_MATERIALS_FILTERS: MaterialsFilters = {
    search: '',
    category: null,
    includeVehicles: true,
};

export const MATERIALS_EMPTY_COPY =
    'No chest data yet. The server sends it every 10 minutes; the first arrives a few minutes after it starts.';

export interface QualityTotal {
    quality: number;
    total: number;
    chests: number;
}

/** One table row: every quality of one prefab. */
export interface MaterialRow {
    prefab: string;
    label: string;
    category: string | null;
    total: number;
    /** The most chests any one quality is in — a lower bound across qualities. */
    chests: number;
    qualities: QualityTotal[];
}

export type MaterialSortKey = 'name' | 'total' | 'chests';
export type SortDir = 'asc' | 'desc';
export interface MaterialSort {
    key: MaterialSortKey;
    dir: SortDir;
}

const fmt = new Intl.NumberFormat('en-US');

/** Fold per-quality totals into one row per prefab, named from the catalogue. */
export function groupTotals(
    totals: readonly ValheimMaterialStack[],
    items: ValheimItemCatalogue,
    atlas: ValheimMapBaseMap | null,
): MaterialRow[] {
    const byPrefab = new Map<string, MaterialRow>();
    for (const t of totals) {
        let row = byPrefab.get(t.prefab);
        if (row === undefined) {
            const r = resolveItem(t.prefab, items, atlas);
            row = {
                prefab: t.prefab,
                label: r.label,
                category: r.category,
                total: 0,
                chests: 0,
                qualities: [],
            };
            byPrefab.set(t.prefab, row);
        }
        row.total += t.total;
        row.chests = Math.max(row.chests, t.chests);
        row.qualities.push({
            quality: t.quality,
            total: t.total,
            chests: t.chests,
        });
    }
    for (const row of byPrefab.values())
        row.qualities.sort((a, b) => a.quality - b.quality);
    return [...byPrefab.values()];
}

/** Case-insensitive match on the display name or the prefab id, then the category. */
export function filterRows(
    rows: readonly MaterialRow[],
    search: string,
    category: string | null,
): MaterialRow[] {
    const needle = search.trim().toLowerCase();
    return rows.filter(
        (r) =>
            (category === null || r.category === category) &&
            (needle === '' ||
                r.label.toLowerCase().includes(needle) ||
                r.prefab.toLowerCase().includes(needle)),
    );
}

function compare(a: MaterialRow, b: MaterialRow, key: MaterialSortKey): number {
    if (key === 'total') return a.total - b.total;
    if (key === 'chests') return a.chests - b.chests;
    return a.label.localeCompare(b.label);
}

/** Stable sort; ties fall back to the name so the order never flickers. */
export function sortRows(
    rows: readonly MaterialRow[],
    sort: MaterialSort,
): MaterialRow[] {
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort(
        (a, b) =>
            sign * compare(a, b, sort.key) || a.label.localeCompare(b.label),
    );
}

/** Distinct non-empty categories, alphabetical. */
export function categoriesOf(rows: readonly MaterialRow[]): string[] {
    const set = new Set<string>();
    for (const r of rows) if (r.category !== null) set.add(r.category);
    return [...set].sort((a, b) => a.localeCompare(b));
}

export const formatCount = (n: number): string => fmt.format(n);

/** "q1 ×1,240 · q2 ×3" — the quality is dropped when only q1 exists. */
export function formatQualities(qualities: readonly QualityTotal[]): string {
    const only = qualities[0];
    if (qualities.length === 1 && only !== undefined && only.quality === 1)
        return `×${fmt.format(only.total)}`;
    return qualities
        .map((q) => `q${q.quality} ×${fmt.format(q.total)}`)
        .join(' · ');
}

const signed = (n: number): string =>
    n < 0 ? `−${Math.abs(Math.round(n))}` : String(Math.round(n));

/** "x 120, z −340" — the ground plane; height is left out. */
export function formatCoords(x: number, z: number): string {
    return `x ${signed(x)}, z ${signed(z)}`;
}

/** "Scanned 7 min ago" from the scan's `capturedAt`. */
export function scanAgeLabel(capturedAt: string, now: number): string {
    const mins = Math.max(
        0,
        Math.floor((now - Date.parse(capturedAt)) / 60_000),
    );
    if (mins < 1) return 'Scanned just now';
    if (mins < 60) return `Scanned ${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Scanned ${hours} h ago`;
    const days = Math.floor(hours / 24);
    return `Scanned ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export interface WarningCounts {
    unreadable: number;
    omittedEntries: number;
    omittedShared: number;
}

/** The warning banner's lines; empty when nothing went wrong. */
export function warningLines(w: WarningCounts): string[] {
    const lines: string[] = [];
    const chests = (n: number) => `${n} ${n === 1 ? 'chest' : 'chests'}`;
    if (w.unreadable > 0)
        lines.push(`${chests(w.unreadable)} could not be read`);
    if (w.omittedEntries > 0)
        lines.push('Some chests had too many items to list');
    if (w.omittedShared > 0)
        lines.push(
            `${chests(w.omittedShared)} ${w.omittedShared === 1 ? 'was' : 'were'} not scanned`,
        );
    return lines;
}

/** Same column flips direction; a new column starts A→Z for names, most-first for counts. */
export function nextSort(
    current: MaterialSort,
    key: MaterialSortKey,
): MaterialSort {
    if (current.key === key)
        return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
    return { key, dir: key === 'name' ? 'asc' : 'desc' };
}

/** A chest's display name from the catalogue (falls back to its prefab id). */
export function chestLabel(
    chest: Pick<ValheimContainerSummary, 'prefab'>,
    ctx: { items: ValheimItemCatalogue; atlas: ValheimMapBaseMap | null },
): string {
    return resolveItem(chest.prefab, ctx.items, ctx.atlas).label;
}
