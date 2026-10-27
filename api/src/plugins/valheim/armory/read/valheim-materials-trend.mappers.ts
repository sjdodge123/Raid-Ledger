/**
 * ROK-2014 — the Materials trend, pure. D10: each shown day's gain is its
 * end-of-day total minus the previous stored day's (an item absent that day
 * counts 0); the oldest header only serves as a baseline, so fewer than two
 * days → no trend (field omitted, AC3). D12: gains only name prefabs of the
 * row set the trend sits beside. OPEN-1: a base is matched across days by
 * key, else by the nearest unclaimed centroid within {@link BASE_LINK_METRES},
 * one-to-one ({@link matchDayBases}).
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

/**
 * Built with `Object.fromEntries` (own data properties), never `gains[k] =`:
 * a `__proto__` prefab would hit the prototype setter and vanish.
 */
function dayGains(
  cur: Totals,
  prev: Totals,
  shown: ReadonlySet<string>,
): Record<string, number> {
  const gains: [string, number][] = [];
  for (const prefab of new Set([...cur.keys(), ...prev.keys()])) {
    if (!shown.has(prefab)) continue;
    const delta = (cur.get(prefab) ?? 0) - (prev.get(prefab) ?? 0);
    if (delta !== 0) gains.push([prefab, delta]);
  }
  return Object.fromEntries(gains);
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

/** A centroid fallback candidate: today's base `anchor` ↔ the day's `hist`. */
interface LinkPair {
  anchor: string;
  hist: string;
  d: number;
  base: DayBase;
}

const byDistance = (a: LinkPair, b: LinkPair): number =>
  a.d - b.d ||
  (a.hist < b.hist ? -1 : a.hist > b.hist ? 1 : 0) ||
  (a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0);

function fallbackPairs(
  day: ReadonlyMap<string, DayBase>,
  open: readonly BaseAnchor[],
  claimed: ReadonlySet<string>,
): LinkPair[] {
  const pairs: LinkPair[] = [];
  for (const [hist, base] of day) {
    if (claimed.has(hist)) continue;
    for (const a of open) {
      const d = (base.x - a.x) ** 2 + (base.z - a.z) ** 2;
      if (d <= LINK_SQ) pairs.push({ anchor: a.key, hist, d, base });
    }
  }
  return pairs.sort(byDistance);
}

/** Historical keys within reach of two or more of today's unmatched bases. */
function contestedOf(pairs: readonly LinkPair[]): Set<string> {
  const seen = new Map<string, string>();
  const out = new Set<string>();
  for (const p of pairs) {
    const first = seen.get(p.hist);
    if (first === undefined) seen.set(p.hist, p.anchor);
    else if (first !== p.anchor) out.add(p.hist);
  }
  return out;
}

/**
 * OPEN-1, one-to-one: today's base key → the day's base. Same key first;
 * else the nearest unclaimed base within 64 m (tie → smaller key). Each of
 * the day's bases links to at most one of today's. One that two of today's
 * unmatched bases could both claim (a split) links to neither, and those
 * bases map to `null` (ambiguous → no trend): an unchanged inventory must
 * never read as a drop, nor a gain. No entry = no base that day (counts 0).
 * NaN centroid = key only.
 */
export function matchDayBases(
  day: ReadonlyMap<string, DayBase>,
  anchors: readonly BaseAnchor[],
): Map<string, DayBase | null> {
  const out = new Map<string, DayBase | null>();
  for (const a of anchors) {
    const same = day.get(a.key);
    if (same) out.set(a.key, same);
  }
  const claimed = new Set(out.keys());
  const pairs = fallbackPairs(
    day,
    anchors.filter((a) => !out.has(a.key)),
    claimed,
  );
  const contested = contestedOf(pairs);
  for (const p of pairs) {
    if (contested.has(p.hist) || claimed.has(p.hist) || out.has(p.anchor))
      continue;
    out.set(p.anchor, p.base);
    claimed.add(p.hist);
  }
  for (const p of pairs) {
    if (contested.has(p.hist) && !out.has(p.anchor)) out.set(p.anchor, null);
  }
  return out;
}

/** day id → today's base key → that day's matched base (built once). */
export type BaseMatches = Map<number, Map<string, DayBase | null>>;

export function indexBaseMatches(
  index: ReadonlyMap<number, ReadonlyMap<string, DayBase>>,
  anchors: readonly BaseAnchor[],
): BaseMatches {
  const out: BaseMatches = new Map();
  for (const [dayId, day] of index) {
    out.set(dayId, matchDayBases(day, anchors));
  }
  return out;
}

/**
 * One base's per-day totals in one segment, from the shared matching;
 * undefined when any day's match is ambiguous (the base gets no trend).
 */
export function baseDayTotals(
  matches: BaseMatches,
  key: string,
  seg: Segment,
): DayTotals | undefined {
  const out: DayTotals = new Map();
  for (const [dayId, day] of matches) {
    const hit = day.get(key);
    if (hit === null) return undefined;
    if (hit) out.set(dayId, hit.totals[seg]);
  }
  return out;
}

export const shownOf = (totals: readonly ValheimMaterialStack[]) =>
  new Set(totals.map((s) => s.prefab));

/** `{ trend }` or nothing — the field is omitted, never `undefined`. */
export const trendField = (trend: ValheimMaterialsTrend | undefined) =>
  trend ? { trend } : {};
