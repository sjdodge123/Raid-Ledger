/**
 * ROK-1859 — per-base material totals. Pure. The caller decides what counts:
 * the `points` it passes are the viewer-visible set under the current
 * includeVehicles (shared for `bases[]`, personal for `personal.byBase[]`);
 * stack sums for chests outside `points` are ignored.
 */
import type {
  ValheimMaterialStack,
  ValheimMaterialsBase,
  ValheimMaterialsPersonalBase,
} from '@raid-ledger/contract';
import {
  assignBases,
  cmp,
  type BaseCluster,
  type BasePoint,
} from './valheim-base-clusters.helpers';

/** One container's sum of one (prefab, quality). */
export interface ChestStackSum {
  key: string;
  prefab: string;
  quality: number;
  total: number;
}

export interface BaseTotals {
  chestCount: number;
  totals: ValheimMaterialStack[];
}

const byStack = (a: ValheimMaterialStack, b: ValheimMaterialStack): number =>
  cmp(a.prefab, b.prefab) || a.quality - b.quality;

function totalsOf(
  keys: ReadonlySet<string>,
  sums: readonly ChestStackSum[],
): ValheimMaterialStack[] {
  const stacks = new Map<string, ValheimMaterialStack>();
  for (const s of sums) {
    if (!keys.has(s.key)) continue;
    const id = `${s.prefab}|${s.quality}`;
    const cur = stacks.get(id);
    if (cur) {
      cur.total += s.total;
      cur.chests += 1;
    } else {
      stacks.set(id, {
        prefab: s.prefab,
        quality: s.quality,
        total: s.total,
        chests: 1,
      });
    }
  }
  return [...stacks.values()].sort(byStack);
}

/** base key (null = away from bases) → chest count + totals. */
export function sumByBase(
  assign: ReadonlyMap<string, string | null>,
  sums: readonly ChestStackSum[],
): Map<string | null, BaseTotals> {
  const keysOf = new Map<string | null, Set<string>>();
  for (const [chest, base] of assign) {
    const set = keysOf.get(base);
    if (set) set.add(chest);
    else keysOf.set(base, new Set([chest]));
  }
  const out = new Map<string | null, BaseTotals>();
  for (const [base, keys] of keysOf) {
    out.set(base, { chestCount: keys.size, totals: totalsOf(keys, sums) });
  }
  return out;
}

/** `bases[]` — `shared` = visible shared chests (vehicles only when included). */
export function toBaseSummaries(
  bases: readonly BaseCluster[],
  shared: readonly BasePoint[],
  sums: readonly ChestStackSum[],
): ValheimMaterialsBase[] {
  const assign = assignBases(shared, bases);
  const totals = sumByBase(assign, sums);
  return bases.map((b) => ({
    key: b.key,
    x: b.x,
    z: b.z,
    chestCount: b.members.length,
    vehicleCount: shared.filter((p) => p.vehicle && assign.get(p.key) === b.key)
      .length,
    totals: totals.get(b.key)?.totals ?? [],
  }));
}

/** `personal.byBase[]` in base order, "away from bases" (null) last. */
export function personalByBase(
  bases: readonly BaseCluster[],
  personal: readonly BasePoint[],
  sums: readonly ChestStackSum[],
): ValheimMaterialsPersonalBase[] {
  const totals = sumByBase(assignBases(personal, bases), sums);
  const order = [...bases.map((b): string | null => b.key), null];
  return order.flatMap((base) => {
    const t = totals.get(base);
    return t ? [{ base, chestCount: t.chestCount, totals: t.totals }] : [];
  });
}
