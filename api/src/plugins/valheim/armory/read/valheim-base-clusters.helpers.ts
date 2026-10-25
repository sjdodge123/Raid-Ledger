/**
 * ROK-1859 — bases on the Materials tab. Pure, deterministic per scan.
 *
 * - A base is a single-link cluster of SHARED, STATIONARY chests whose x/z
 *   (map-plane) distance is ≤ 64 m. Height is ignored so stacked storage
 *   rooms never split.
 * - Carts, ships and personal chests ATTACH to the base with the nearest
 *   stationary member within 64 m (tie → smaller base key) but never form or
 *   merge a base — so neither the vehicles toggle nor a hidden personal chest
 *   can reshape bases, and every viewer sees the same ones.
 * - Base key = smallest member key (JS code-unit order); bases sort by
 *   chestCount desc, key asc. Input order never matters.
 * - Index = 1-based among chests of the same prefab in the same base, ordered
 *   x, z, y, key. Shared and personal chests are numbered apart, so a member
 *   can never infer a hidden personal chest from a gap.
 */
export const BASE_LINK_METRES = 64;
const LINK_SQ = BASE_LINK_METRES * BASE_LINK_METRES;

export interface BasePoint {
  key: string;
  x: number;
  z: number;
  vehicle: boolean;
  /** false = a personal (private) chest. */
  shared: boolean;
}

export interface BaseCluster {
  key: string;
  /** Rounded centroid of the stationary members. */
  x: number;
  z: number;
  /** Stationary shared members, sorted by key. */
  members: readonly BasePoint[];
}

export interface ChestIndexRow {
  key: string;
  prefab: string;
  x: number;
  y: number;
  z: number;
  shared: boolean;
  base: string | null;
}

type Cells<T> = Map<string, T[]>;

export const cmp = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
const cell = (v: number): number => Math.floor(v / BASE_LINK_METRES);
const cellId = (cx: number, cz: number): string => `${cx}:${cz}`;
const distSq = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/** Only shared, stationary chests form (and link) bases. */
export function formsBase(p: BasePoint): boolean {
  return p.shared && !p.vehicle;
}

function cellsOf<T>(items: readonly T[], at: (t: T) => BasePoint): Cells<T> {
  const cells: Cells<T> = new Map();
  for (const item of items) {
    const p = at(item);
    const id = cellId(cell(p.x), cell(p.z));
    const list = cells.get(id);
    if (list) list.push(item);
    else cells.set(id, [item]);
  }
  return cells;
}

/** Everything in the 3×3 cells around `p` (candidates, not yet distance-checked). */
function around<T>(cells: Cells<T>, p: { x: number; z: number }): T[] {
  const out: T[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      out.push(...(cells.get(cellId(cell(p.x) + dx, cell(p.z) + dz)) ?? []));
    }
  }
  return out;
}

function root(parent: number[], i: number): number {
  let r = i;
  for (let up = parent[r] ?? r; up !== r; up = parent[r] ?? r) r = up;
  for (let j = i, up = parent[j] ?? j; up !== j; j = up, up = parent[j] ?? j) {
    parent[j] = r;
  }
  return r;
}

/** Union-find over a 64 m grid; the root of a component is its smallest index. */
function components(formers: readonly BasePoint[]): number[] {
  const parent = formers.map((_, i) => i);
  const cells = cellsOf(
    formers.map((p, i) => ({ p, i })),
    (e) => e.p,
  );
  formers.forEach((p, i) => {
    for (const other of around(cells, p)) {
      if (other.i <= i || distSq(p, other.p) > LINK_SQ) continue;
      const [a, b] = [root(parent, i), root(parent, other.i)];
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  });
  return formers.map((_, i) => root(parent, i));
}

const centre = (vs: number[]): number =>
  Math.round(vs.reduce((s, v) => s + v, 0) / vs.length) || 0;

/** Bases of a scan, from the full shared set (never filtered by item). */
export function clusterBases(points: readonly BasePoint[]): BaseCluster[] {
  const formers = points.filter(formsBase).sort((a, b) => cmp(a.key, b.key));
  const roots = components(formers);
  // Formers are key-sorted and a root is its component's smallest index, so
  // the first point seen for a root is that base's smallest key.
  const groups = new Map<number, { key: string; members: BasePoint[] }>();
  formers.forEach((p, i) => {
    const r = roots[i] ?? i;
    const group = groups.get(r);
    if (group) group.members.push(p);
    else groups.set(r, { key: p.key, members: [p] });
  });
  return [...groups.values()]
    .map(({ key, members }) => ({
      key,
      x: centre(members.map((m) => m.x)),
      z: centre(members.map((m) => m.z)),
      members,
    }))
    .sort((a, b) => b.members.length - a.members.length || cmp(a.key, b.key));
}

export type BaseGrid = Cells<{ p: BasePoint; base: string }>;

export function baseGrid(bases: readonly BaseCluster[]): BaseGrid {
  const entries = bases.flatMap((b) =>
    b.members.map((p) => ({ p, base: b.key })),
  );
  return cellsOf(entries, (e) => e.p);
}

/** The base with the nearest member within 64 m (tie → smaller key), or null. */
export function attachToBase(
  point: { x: number; z: number },
  grid: BaseGrid,
): string | null {
  let best: { d: number; base: string } | null = null;
  for (const { p, base } of around(grid, point)) {
    const d = distSq(point, p);
    if (d > LINK_SQ) continue;
    if (!best || d < best.d || (d === best.d && cmp(base, best.base) < 0)) {
      best = { d, base };
    }
  }
  return best?.base ?? null;
}

/** chest key → base key (members by cluster, everything else by attachment). */
export function assignBases(
  points: readonly BasePoint[],
  bases: readonly BaseCluster[],
): Map<string, string | null> {
  const memberOf = new Map<string, string>();
  for (const b of bases) for (const m of b.members) memberOf.set(m.key, b.key);
  const grid = baseGrid(bases);
  return new Map(
    points.map((p) => [p.key, memberOf.get(p.key) ?? attachToBase(p, grid)]),
  );
}

const byPosition = (a: ChestIndexRow, b: ChestIndexRow): number =>
  a.x - b.x || a.z - b.z || a.y - b.y || cmp(a.key, b.key);

/** chest key → 1-based index within (shared|personal, base, prefab). */
export function indexChests(
  rows: readonly ChestIndexRow[],
): Map<string, number> {
  const groups = new Map<string, ChestIndexRow[]>();
  for (const r of rows) {
    const id = `${r.shared ? 's' : 'p'}|${r.base ?? ''}|${r.prefab}`;
    const list = groups.get(id);
    if (list) list.push(r);
    else groups.set(id, [r]);
  }
  const out = new Map<string, number>();
  for (const list of groups.values()) {
    [...list].sort(byPosition).forEach((r, i) => out.set(r.key, i + 1));
  }
  return out;
}
