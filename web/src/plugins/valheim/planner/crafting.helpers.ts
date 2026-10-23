/**
 * ROK-1899 — pure view model for the Planner crafting window (spec §2.4):
 * per-step affordability against the viewer's stock totals, the detail
 * pane's ingredient slots, the station switcher's groups, the list order and
 * the greyed row's `aria-description`. Direct ingredients only; the station
 * level never affects greying.
 */
import type {
    ValheimRecipeCatalogEntry,
    ValheimRecipeCost,
    ValheimRecipeStation,
} from '@raid-ledger/contract';
import type { PlannerFilters } from './planner.helpers';

/** prefab → count from `GET …/recipes/stock`; null = no scan or not loaded. */
export type StockTotals = Readonly<Record<string, number>>;

export interface MissingLine {
    prefab: string;
    /** need − have */
    more: number;
}

export type Affordability =
    | { state: 'unknown' }
    | { state: 'can' }
    | { state: 'short'; anyOneOf: boolean; missing: MissingLine[] };

export interface SlotLine {
    prefab: string;
    need: number;
    have: number | null;
    short: number | null;
}

export type CraftMode = 'craft' | 'upgrade';

/** One list row: the entry plus the step it greys on (CRAFT q1, UPGRADE 1 → 2). */
export interface CraftRow {
    entry: ValheimRecipeCatalogEntry;
    cost: ValheimRecipeCost;
    stationKey: string;
    stationLabel: string;
}

export interface RankedRow extends CraftRow {
    afford: Affordability;
}

export interface StationGroup {
    /** Station prefab, or BY_HAND_KEY. */
    key: string;
    label: string;
    /** Catalogue max level for the star badge; null for By hand / unknown stations. */
    maxLevel: number | null;
    rows: CraftRow[];
}

export const BY_HAND_KEY = '__hand__';
export const BY_HAND_LABEL = 'By hand';

/** Covered when every resource is (anyOneOf: any ONE is); unknown without totals. */
export function affordability(cost: ValheimRecipeCost, totals: StockTotals | null): Affordability {
    if (totals === null) return { state: 'unknown' };
    const missing = cost.resources
        .map((r) => ({ prefab: r.prefab, more: Math.max(0, r.amount - (totals[r.prefab] ?? 0)) }))
        .filter((m) => m.more > 0);
    const covered = cost.anyOneOf
        ? cost.resources.length === 0 || missing.length < cost.resources.length
        : missing.length === 0;
    return covered ? { state: 'can' } : { state: 'short', anyOneOf: cost.anyOneOf, missing };
}

/** The detail pane's slots: need, "you have N" and the shortfall (null with no scan). */
export function slotLines(cost: ValheimRecipeCost, totals: StockTotals | null): SlotLine[] {
    return cost.resources.map((r) => {
        const have = totals === null ? null : (totals[r.prefab] ?? 0);
        return { prefab: r.prefab, need: r.amount, have, short: have === null ? null : Math.max(0, r.amount - have) };
    });
}

/** "Can't craft yet: need 7 more Wood, 1 more Tin" (anyOneOf: "need one of … or …"); undefined unless short. */
export function rowDescription(result: Affordability, nameOf: (prefab: string) => string): string | undefined {
    if (result.state !== 'short') return undefined;
    const parts = result.missing.map((m) => `${m.more.toLocaleString('en-US')} more ${nameOf(m.prefab)}`);
    return result.anyOneOf
        ? `Can't craft yet: need one of ${parts.join(' or ')}`
        : `Can't craft yet: need ${parts.join(', ')}`;
}

/** The step a row stands for in `mode`; process outputs get no station entry (operator ruling 2026-10-22). */
function stepOf(e: ValheimRecipeCatalogEntry, mode: CraftMode): ValheimRecipeCost | null {
    if (mode === 'upgrade') return e.upgrades[0] ?? null;
    return e.craft !== null && e.craft.via !== 'process' ? e.craft : null;
}

function passes(e: ValheimRecipeCatalogEntry, f: Pick<PlannerFilters, 'kind' | 'category'>): boolean {
    return (f.kind === 'both' || e.kind === f.kind) && (f.category === null || e.category === f.category);
}

/**
 * Rows of `mode` that pass Kind/Category, grouped by station: stations by
 * name, then "By hand" (`station === null`). Only stations with ≥1 row
 * appear (every station, built or not — no world data yet). Rows keep
 * catalogue order; order them with `sortRows`.
 */
export function stationGroups(
    entries: readonly ValheimRecipeCatalogEntry[],
    stations: readonly ValheimRecipeStation[],
    mode: CraftMode,
    filters: Pick<PlannerFilters, 'kind' | 'category'>,
): StationGroup[] {
    const byPrefab = new Map(stations.map((s) => [s.prefab, s]));
    const groups = new Map<string, StationGroup>();
    for (const entry of entries) {
        const cost = stepOf(entry, mode);
        if (cost === null || !passes(entry, filters)) continue;
        const key = cost.station ?? BY_HAND_KEY;
        const station = cost.station === null ? undefined : byPrefab.get(cost.station);
        const label = cost.station === null ? BY_HAND_LABEL : (station?.name ?? cost.station);
        const group = groups.get(key) ?? { key, label, maxLevel: station?.maxLevel ?? null, rows: [] };
        group.rows.push({ entry, cost, stationKey: key, stationLabel: label });
        groups.set(key, group);
    }
    return [...groups.values()].sort(
        (a, b) => Number(a.key === BY_HAND_KEY) - Number(b.key === BY_HAND_KEY) || a.label.localeCompare(b.label),
    );
}

/** Rows across every group whose name or prefab contains `text` (case-insensitive); blank text → none. */
export function searchRows(groups: readonly StationGroup[], text: string): CraftRow[] {
    const needle = text.trim().toLowerCase();
    if (needle === '') return [];
    return groups.flatMap((g) =>
        g.rows.filter((r) => r.entry.name.toLowerCase().includes(needle) || r.entry.prefab.toLowerCase().includes(needle)),
    );
}

const RANK: Record<Affordability['state'], number> = { can: 0, short: 1, unknown: 2 };

/**
 * Attaches affordability and orders can → short → unknown, then by name.
 * Pass one `cache` per `totals` so a row keeps its ranked object (and memoised
 * list rows skip re-rendering) across searches and station switches.
 */
export function sortRows(rows: readonly CraftRow[], totals: StockTotals | null, cache?: WeakMap<CraftRow, RankedRow>): RankedRow[] {
    const rank = (r: CraftRow): RankedRow => {
        const hit = cache?.get(r);
        if (hit !== undefined) return hit;
        const ranked = { ...r, afford: affordability(r.cost, totals) };
        cache?.set(r, ranked);
        return ranked;
    };
    return rows
        .map(rank)
        .sort((a, b) => RANK[a.afford.state] - RANK[b.afford.state] || a.entry.name.localeCompare(b.entry.name));
}
