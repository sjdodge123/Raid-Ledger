/**
 * ROK-2014 — the Materials trend, pure. D10: each shown day's gain is its
 * end-of-day total minus the previous stored day's (an item absent that day
 * counts 0); the oldest header only serves as a baseline, so fewer than two
 * days → no trend (field omitted, AC3). D12: gains only name prefabs of the
 * row set the trend sits beside. OPEN-1: a base is matched across days by
 * key, else by the nearest unclaimed centroid within {@link BASE_LINK_METRES}.
 */
import type {
  ValheimMaterialStack,
  ValheimMaterialsTrend,
} from '@raid-ledger/contract';
import { BASE_LINK_METRES } from './valheim-base-clusters.helpers';
import { toCount } from './valheim-materials.mappers';
import type {
  TrendBaseSumRow,
  TrendDayRow,
  TrendItemSumRow,
} from './valheim-materials-trend.queries';

/** Days the chip shows (same as the Skills chip). */
export const MATERIALS_TREND_DAYS = 3;

/** prefab → end-of-day total. */
type Totals = Map<string, number>;
/** day id → that day's totals. */
type DayTotals = Map<number, Totals>;
type Segment = 'shared' | 'personal';
type SegTotals = Record<Segment, DayTotals>;

/** A day's base as stored: its centroid and per-segment totals. */
interface DayBase {
  x: number;
  z: number;
  totals: Record<Segment, Totals>;
}

/** Where a base is today — `x`/`z` NaN = no centroid (key match only). */
export interface BaseAnchor {
  key: string;
  x: number;
  z: number;
}

const segOf = (r: TrendItemSumRow): Segment =>
  r.shared ? 'shared' : 'personal';

function add(totals: Totals, prefab: string, n: number): void {
  totals.set(prefab, (totals.get(prefab) ?? 0) + n);
}

function getOrSet<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  const hit = map.get(key);
  if (hit !== undefined) return hit;
  const v = make();
  map.set(key, v);
  return v;
}

/** Item sums → per segment, per day, per prefab. */
export function indexItemSums(rows: readonly TrendItemSumRow[]): SegTotals {
  const out: SegTotals = { shared: new Map(), personal: new Map() };
  for (const r of rows) {
    const day = getOrSet(out[segOf(r)], r.dayId, (): Totals => new Map());
    add(day, r.prefab, toCount(r.total));
  }
  return out;
}

/** Base sums → day id → base key → centroid + per-segment totals. */
export function indexBaseSums(
  rows: readonly TrendBaseSumRow[],
): Map<number, Map<string, DayBase>> {
  const out = new Map<number, Map<string, DayBase>>();
  for (const r of rows) {
    const day = getOrSet(out, r.dayId, () => new Map<string, DayBase>());
    const base = getOrSet(day, r.baseKey, () => ({
      x: r.baseX,
      z: r.baseZ,
      totals: {
        shared: new Map<string, number>(),
        personal: new Map<string, number>(),
      },
    }));
    add(base.totals[segOf(r)], r.prefab, toCount(r.total));
  }
  return out;
}

const newestFirst = (days: readonly TrendDayRow[]): TrendDayRow[] =>
  [...days].sort((a, b) => (a.playDate < b.playDate ? 1 : -1));

function dayGains(cur: Totals, prev: Totals, shown: ReadonlySet<string>) {
  const gains: Record<string, number> = {};
  for (const prefab of new Set([...cur.keys(), ...prev.keys()])) {
    if (!shown.has(prefab)) continue;
    const delta = (cur.get(prefab) ?? 0) - (prev.get(prefab) ?? 0);
    if (delta !== 0) gains[prefab] = delta;
  }
  return gains;
}

/** D10 + D12. `totals` may lack a day (nothing in scope that day = 0). */
export function toTrend(
  days: readonly TrendDayRow[],
  totals: DayTotals,
  shown: ReadonlySet<string>,
): ValheimMaterialsTrend | undefined {
  const sorted = newestFirst(days);
  if (sorted.length < 2) return undefined;
  const at = (d: TrendDayRow): Totals =>
    totals.get(d.id) ?? new Map<string, number>();
  const out: ValheimMaterialsTrend['days'] = [];
  sorted.slice(0, MATERIALS_TREND_DAYS).forEach((cur, i) => {
    const prev = sorted[i + 1];
    if (prev)
      out.push({
        date: cur.playDate,
        gains: dayGains(at(cur), at(prev), shown),
      });
  });
  return { days: out };
}

const LINK_SQ = BASE_LINK_METRES * BASE_LINK_METRES;

/**
 * OPEN-1: the day's base for `anchor` — same key, else the nearest base
 * within 64 m whose key is not one of today's (`current`); tie → smaller key.
 */
export function matchDayBase(
  day: ReadonlyMap<string, DayBase>,
  anchor: BaseAnchor,
  current: ReadonlySet<string>,
): DayBase | undefined {
  const same = day.get(anchor.key);
  if (same) return same;
  let best: { key: string; d: number; base: DayBase } | undefined;
  for (const [key, base] of day) {
    if (current.has(key)) continue;
    const d = (base.x - anchor.x) ** 2 + (base.z - anchor.z) ** 2;
    if (!(d <= LINK_SQ)) continue;
    if (!best || d < best.d || (d === best.d && key < best.key)) {
      best = { key, d, base };
    }
  }
  return best?.base;
}

/** One base's per-day totals in one segment, matched day by day. */
export function baseDayTotals(
  index: ReadonlyMap<number, ReadonlyMap<string, DayBase>>,
  anchor: BaseAnchor,
  current: ReadonlySet<string>,
  seg: Segment,
): DayTotals {
  const out: DayTotals = new Map();
  for (const [dayId, day] of index) {
    const hit = matchDayBase(day, anchor, current);
    if (hit) out.set(dayId, hit.totals[seg]);
  }
  return out;
}

export const shownOf = (totals: readonly ValheimMaterialStack[]) =>
  new Set(totals.map((s) => s.prefab));

/** `{ trend }` or nothing — the field is omitted, never `undefined`. */
export const trendField = (trend: ValheimMaterialsTrend | undefined) =>
  trend ? { trend } : {};
