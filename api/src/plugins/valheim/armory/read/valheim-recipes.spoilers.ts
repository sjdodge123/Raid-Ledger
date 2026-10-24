/**
 * ROK-1948 — server-wide spoiler protection. Pure: no Nest, no DB.
 *
 * `serverKnown` unions every profile's known lists on ONE server (D2/D3/D4:
 * no viewer, no claim, empty and token-only lists unusable). `buildVisibleGraph`
 * prunes the shared recipe graph to what someone on the server has discovered
 * (§4 R1–R4), so every existing projection runs unchanged on it and cannot
 * name, count or pick a hidden source (D1). `withheld` lists the prefabs the
 * pruning removed: the resolver ends each in a NAMED `undiscovered` leaf with
 * nothing under it (D7, operator ruling 2026-10-24).
 */
import type {
  ValheimPiece,
  ValheimProcess,
  ValheimRecipe,
  ValheimRecipeCatalogEntry,
  ValheimRecipeSpoilers,
  ValheimRecipeStation,
} from '@raid-ledger/contract';
import { ARMORY_KNOWN_LIST_MAX } from '../valheim-armory.mappers';
import { usableEntries } from './valheim-recipes.discovery';
import type { RecipeGraph } from './valheim-recipes.graph';
import { stationAt } from './valheim-recipes.resolve.helpers';

/** One stored profile's two discovery lists (`known_recipes`, `known_items`). */
export interface ProfileKnownLists {
  knownRecipes: readonly string[];
  knownItems: readonly string[];
}

/** The server's union; both sets are empty unless `status === 'protected'`. */
export interface ServerKnown {
  status: ValheimRecipeSpoilers;
  /** `R`: recipe ids, result prefabs, piece/station/processor prefabs. */
  recipes: ReadonlySet<string>;
  /** `I`: known material prefabs. */
  items: ReadonlySet<string>;
}

/** A spoiler-pruned graph: always carries `withheld`. */
export type VisibleGraph = RecipeGraph & { withheld: ReadonlySet<string> };

/** D3: prefab entries of a list; empty and token-only lists give none. */
function usablePrefabs(list: readonly string[]): string[] {
  return usableEntries(list) ?? [];
}

function off(status: ValheimRecipeSpoilers): ServerKnown {
  return { status, recipes: new Set(), items: new Set() };
}

/**
 * D4: any `known_recipes` list at the store cap → `off-truncated` (a cut
 * list would over-hide; the spec keys D4 on recipes only, so a capped
 * `known_items` list stays protected and only under-reveals materials);
 * no usable non-empty `known_recipes` anywhere → `off-no-data`; else
 * `protected` with the union of every usable list.
 */
export function serverKnown(lists: readonly ProfileKnownLists[]): ServerKnown {
  if (lists.some((p) => p.knownRecipes.length >= ARMORY_KNOWN_LIST_MAX)) {
    return off('off-truncated');
  }
  const recipes = new Set(lists.flatMap((p) => usablePrefabs(p.knownRecipes)));
  if (recipes.size === 0) return off('off-no-data');
  const items = new Set(lists.flatMap((p) => usablePrefabs(p.knownItems)));
  return { status: 'protected', recipes, items };
}

function allRecipes(graph: RecipeGraph): ValheimRecipe[] {
  return [...graph.recipesByResult.values()].flat();
}

/** R3's knowledge test: the recipe id OR its result prefab is listed. */
function recipeKnown(r: ValheimRecipe, known: ReadonlySet<string>): boolean {
  return known.has(r.id) || known.has(r.result);
}

/** Workplaces a known recipe (q1) or a known piece needs (R2, A2). */
function neededByKnown(full: RecipeGraph, known: ReadonlySet<string>) {
  const out = new Set<string>();
  for (const r of allRecipes(full)) {
    const s = stationAt(r, 1);
    if (s !== null && recipeKnown(r, known)) out.add(s);
  }
  for (const p of full.pieces.values()) {
    if (p.station !== null && known.has(p.prefab)) out.add(p.station);
  }
  return out;
}

/** R2 (stations) and R2-for-processors: listed, or needed by something known. */
function visibleWorkplaces<T>(
  all: ReadonlyMap<string, T>,
  known: ReadonlySet<string>,
  needed: ReadonlySet<string>,
): Map<string, T> {
  return new Map(
    [...all].filter(([prefab]) => known.has(prefab) || needed.has(prefab)),
  );
}

/** R1: a listed piece whose station (if any) is visible. */
function visiblePieces(
  full: RecipeGraph,
  known: ReadonlySet<string>,
  stations: ReadonlyMap<string, unknown>,
): Map<string, ValheimPiece> {
  return new Map(
    [...full.pieces].filter(
      ([prefab, p]) =>
        known.has(prefab) && (p.station === null || stations.has(p.station)),
    ),
  );
}

/** R3: a known recipe whose q1 station (if any) is visible. Order kept. */
function keptRecipes(
  full: RecipeGraph,
  known: ReadonlySet<string>,
  stations: ReadonlyMap<string, unknown>,
): Map<string, ValheimRecipe[]> {
  const keep = (r: ValheimRecipe) => {
    const s = stationAt(r, 1);
    return recipeKnown(r, known) && (s === null || stations.has(s));
  };
  return filterBuckets(full.recipesByResult, keep);
}

function filterBuckets<T>(
  buckets: ReadonlyMap<string, readonly T[]>,
  keep: (v: T) => boolean,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const [key, list] of buckets) {
    const kept = list.filter(keep);
    if (kept.length > 0) out.set(key, kept);
  }
  return out;
}

/** R4 seed: `I` ∪ every resource of a kept recipe or visible piece. */
function materialSeed(
  items: ReadonlySet<string>,
  recipes: ReadonlyMap<string, readonly ValheimRecipe[]>,
  pieces: ReadonlyMap<string, ValheimPiece>,
): Set<string> {
  const out = new Set(items);
  for (const list of recipes.values()) {
    for (const r of list) for (const res of r.resources) out.add(res.prefab);
  }
  for (const p of pieces.values()) {
    for (const res of p.resources) out.add(res.prefab);
  }
  return out;
}

/**
 * R4: a process on a visible processor whose output or any input is
 * materially visible; a kept output becomes materially visible, so iterate
 * to a fixed point (at most one pass per process). Order kept.
 */
function keptProcesses(
  full: RecipeGraph,
  processors: ReadonlyMap<string, unknown>,
  material: Set<string>,
): Map<string, ValheimProcess[]> {
  const kept = new Set<ValheimProcess>();
  const candidates = [...full.processesByOutput.values()]
    .flat()
    .filter((x) => processors.has(x.processor));
  const touches = (x: ValheimProcess) =>
    material.has(x.output.prefab) ||
    x.inputs.some((i) => material.has(i.prefab));
  for (let grew = true; grew;) {
    grew = false;
    for (const x of candidates) {
      if (kept.has(x) || !touches(x)) continue;
      kept.add(x);
      material.add(x.output.prefab);
      grew = true;
    }
  }
  return filterBuckets(full.processesByOutput, (x) => kept.has(x));
}

/** Every prefab some recipe, process or piece of the graph makes. */
function sourcedPrefabs(graph: RecipeGraph): Set<string> {
  return new Set([
    ...graph.recipesByResult.keys(),
    ...graph.processesByOutput.keys(),
    ...graph.pieces.keys(),
  ]);
}

/** §4: the pruned copy of `full` (never mutated) for a `protected` server. */
export function buildVisibleGraph(
  full: RecipeGraph,
  known: Pick<ServerKnown, 'recipes' | 'items'>,
): VisibleGraph {
  const needed = neededByKnown(full, known.recipes);
  const stations = visibleWorkplaces(full.stations, known.recipes, needed);
  const processors = visibleWorkplaces(full.processors, known.recipes, needed);
  const pieces = visiblePieces(full, known.recipes, stations);
  const recipesByResult = keptRecipes(full, known.recipes, stations);
  const material = materialSeed(known.items, recipesByResult, pieces);
  const processesByOutput = keptProcesses(full, processors, material);
  const visible: RecipeGraph = {
    costRule: full.costRule,
    recipesByResult,
    processesByOutput,
    processors,
    stations,
    pieces,
  };
  const shown = sourcedPrefabs(visible);
  const withheld = new Set(
    [...sourcedPrefabs(full)].filter((p) => !shown.has(p)).sort(),
  );
  return { ...visible, withheld };
}

/** D4: the graph a response is built from — the full one while protection is off. */
export function spoilerGraph(
  full: RecipeGraph,
  known: ServerKnown,
): RecipeGraph {
  return known.status === 'protected' ? buildVisibleGraph(full, known) : full;
}

/**
 * Q4 (ruled): a station's `maxLevel` would reveal how many upgrades exist, so
 * clamp it to the highest level a shown craft or upgrade step needs there
 * (min 1, never above the real value). Apply only while `protected`.
 */
export function clampStationLevels(
  stations: readonly ValheimRecipeStation[],
  entries: readonly ValheimRecipeCatalogEntry[],
): ValheimRecipeStation[] {
  const need = new Map<string, number>();
  const note = (s: string | null, level: number) => {
    if (s !== null) need.set(s, Math.max(need.get(s) ?? 1, level));
  };
  for (const e of entries) {
    if (e.craft) note(e.craft.station, e.craft.stationLevel);
    for (const u of e.upgrades) note(u.station, u.stationLevel);
  }
  return stations.map((s) => ({
    ...s,
    maxLevel: Math.min(s.maxLevel, need.get(s.prefab) ?? 1),
  }));
}
