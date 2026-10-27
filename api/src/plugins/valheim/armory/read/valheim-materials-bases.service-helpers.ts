/**
 * ROK-1859 L2 — glue between the read transaction's rows and the pure base
 * helpers. `toBaseView` takes EVERY chest the viewer may see under the
 * current includeVehicles (never `holding`-filtered), so:
 * - bases come from the shared stationary chests only — the same for every
 *   viewer, whatever their personal chests (D1/D2);
 * - chest indices are stable whatever item the list is filtered by (D5),
 *   and personal chests are numbered over the viewer's own visible set (D7).
 */
import type {
  ValheimMaterialStack,
  ValheimMaterialsBase,
  ValheimMaterialsPersonalBase,
  ValheimMaterialsResponse,
} from '@raid-ledger/contract';
import {
  assignBases,
  clusterBases,
  indexChests,
  type BaseCluster,
  type BasePoint,
} from './valheim-base-clusters.helpers';
import {
  personalByBase,
  toBaseSummaries,
  type ChestStackSum,
} from './valheim-base-totals.helpers';
import type {
  BaseInputRow,
  StackSumRow,
} from './valheim-materials-bases.queries';
import { toCount } from './valheim-materials.mappers';
import type { TrendInputs } from './valheim-materials-trend.queries';
import {
  baseDayTotals,
  indexBaseMatches,
  indexBaseSums,
  indexItemSums,
  shownOf,
  toTrend,
  trendField,
  type BaseAnchor,
  type BaseMatches,
} from './valheim-materials-trend.mappers';

/** Where a chest sits: its base (null = away from bases) and its number. */
export interface ChestPlace {
  base: string | null;
  index: number;
}

export interface BaseView {
  bases: BaseCluster[];
  shared: BasePoint[];
  personal: BasePoint[];
  places: Map<string, ChestPlace>;
}

const toPoint = (r: BaseInputRow): BasePoint => ({
  key: r.key,
  x: r.x,
  z: r.z,
  vehicle: r.vehicle,
  shared: r.shared,
});

export function toBaseView(rows: readonly BaseInputRow[]): BaseView {
  const points = rows.map(toPoint);
  const bases = clusterBases(points);
  const assign = assignBases(points, bases);
  const index = indexChests(
    rows.map((r) => ({ ...r, base: assign.get(r.key) ?? null })),
  );
  const places = new Map<string, ChestPlace>();
  for (const r of rows) {
    const n = index.get(r.key);
    if (n === undefined) throw new Error(`no index for chest ${r.key}`);
    places.set(r.key, { base: assign.get(r.key) ?? null, index: n });
  }
  return {
    bases,
    shared: points.filter((p) => p.shared),
    personal: points.filter((p) => !p.shared),
    places,
  };
}

/** A listed chest's place — it is in the view by construction (same tx + scope). */
export function placeOf(view: BaseView, key: string): ChestPlace {
  const place = view.places.get(key);
  if (!place) throw new Error(`chest ${key} outside its base view`);
  return place;
}

const stackId = (s: { prefab: string; quality: number }) =>
  `${s.prefab}|${s.quality}`;

/**
 * Re-sort `stacks` into `reference`'s order (the tab's SQL `ORDER BY prefab,
 * quality`, which collates differently from JS for mixed-case prefabs), so a
 * base's totals list in the same order as the shared totals.
 */
export function orderLike(
  reference: readonly ValheimMaterialStack[],
  stacks: readonly ValheimMaterialStack[],
): ValheimMaterialStack[] {
  const at = new Map(reference.map((s, i) => [stackId(s), i]));
  const pos = (s: ValheimMaterialStack) =>
    at.get(stackId(s)) ?? Number.MAX_SAFE_INTEGER;
  return [...stacks].sort((a, b) => pos(a) - pos(b));
}

const toSum = (r: StackSumRow): ChestStackSum => ({
  key: r.key,
  prefab: r.prefab,
  quality: r.quality,
  total: toCount(r.total),
});

/** `bases[]` + `personal.byBase[]`, totals in the tab's own order. */
export function materialsBases(
  view: BaseView,
  sumRows: readonly StackSumRow[],
  order: { shared: ValheimMaterialStack[]; personal: ValheimMaterialStack[] },
): { bases: ValheimMaterialsBase[]; byBase: ValheimMaterialsPersonalBase[] } {
  const sums = sumRows.map(toSum);
  return {
    bases: toBaseSummaries(view.bases, view.shared, sums).map((b) => ({
      ...b,
      totals: orderLike(order.shared, b.totals),
    })),
    byBase: personalByBase(view.bases, view.personal, sums).map((b) => ({
      ...b,
      totals: orderLike(order.personal, b.totals),
    })),
  };
}

/** One request's indexed trend inputs (built once, read per row set). */
interface TrendCtx {
  days: TrendInputs['days'];
  items: ReturnType<typeof indexItemSums>;
  /** One-to-one, shared by `bases[]` and `byBase[]` (OPEN-1). */
  matches: BaseMatches;
}

type Seg = 'shared' | 'personal';

const itemTrend = (ctx: TrendCtx, seg: Seg, t: ValheimMaterialStack[]) =>
  trendField(toTrend(ctx.days, ctx.items[seg], shownOf(t)));

function baseTrend(
  ctx: TrendCtx,
  key: string,
  seg: Seg,
  t: ValheimMaterialStack[],
) {
  const totals = baseDayTotals(ctx.matches, key, seg);
  if (!totals) return {};
  return trendField(toTrend(ctx.days, totals, shownOf(t)));
}

/** A byBase row near no base gets no trend. */
function byBaseTrend(
  ctx: TrendCtx,
  row: ValheimMaterialsPersonalBase,
): ValheimMaterialsPersonalBase {
  if (row.base === null) return row;
  return { ...row, ...baseTrend(ctx, row.base, 'personal', row.totals) };
}

/** Today's bases, plus any byBase key outside them (no centroid = key only). */
function anchorsOf(res: ValheimMaterialsResponse): BaseAnchor[] {
  const out = new Map<string, BaseAnchor>(
    (res.bases ?? []).map((b) => [b.key, { key: b.key, x: b.x, z: b.z }]),
  );
  for (const r of res.personal?.byBase ?? []) {
    if (r.base !== null && !out.has(r.base))
      out.set(r.base, { key: r.base, x: Number.NaN, z: Number.NaN });
  }
  return [...out.values()];
}

function personalWithTrend(
  ctx: TrendCtx,
  p: ValheimMaterialsResponse['personal'],
): ValheimMaterialsResponse['personal'] {
  if (!p) return p;
  return {
    ...p,
    ...itemTrend(ctx, 'personal', p.totals),
    ...(p.byBase ? { byBase: p.byBase.map((r) => byBaseTrend(ctx, r)) } : {}),
  };
}

/**
 * ROK-2014 — attach the trend to `shared`, `personal`, every `bases[]` and
 * every `personal.byBase[]`. Fewer than two stored play days → the response
 * is returned unchanged (AC3).
 */
export function withMaterialsTrend(
  res: ValheimMaterialsResponse,
  input: TrendInputs,
): ValheimMaterialsResponse {
  if (input.days.length < 2) return res;
  const bases = res.bases ?? [];
  const ctx: TrendCtx = {
    days: input.days,
    items: indexItemSums(input.items),
    matches: indexBaseMatches(indexBaseSums(input.bases), anchorsOf(res)),
  };
  const withBases = res.bases
    ? {
        bases: bases.map((b) => ({
          ...b,
          ...baseTrend(ctx, b.key, 'shared', b.totals),
        })),
      }
    : {};
  return {
    ...res,
    shared: { ...res.shared, ...itemTrend(ctx, 'shared', res.shared.totals) },
    ...withBases,
    personal: personalWithTrend(ctx, res.personal),
  };
}
