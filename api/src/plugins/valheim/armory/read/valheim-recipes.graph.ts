/**
 * ROK-1854 D5 — the in-memory recipe graph of one recipes set, plus a small
 * per-process LRU. Pure: no Nest, no DB. L3b maps the stored rows (which
 * mirror the wire types field-for-field) into `RecipeGraphRows`.
 */
import type {
  ValheimCraftingStation,
  ValheimPiece,
  ValheimProcess,
  ValheimProcessor,
  ValheimRecipe,
} from '@raid-ledger/contract';

/** One recipes set, in wire shape. */
export interface RecipeGraphRows {
  recipes: ValheimRecipe[];
  pieces: ValheimPiece[];
  stations: ValheimCraftingStation[];
  processors: ValheimProcessor[];
  processes: ValheimProcess[];
}

export interface RecipeGraph {
  /** Result prefab → recipes, sorted by `id` (D9 tie order). */
  recipesByResult: Map<string, ValheimRecipe[]>;
  /** Output prefab → processes, sorted by processor prefab, then priority desc. */
  processesByOutput: Map<string, ValheimProcess[]>;
  processors: Map<string, ValheimProcessor>;
  stations: Map<string, ValheimCraftingStation>;
  pieces: Map<string, ValheimPiece>;
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function groupBy<T>(
  list: readonly T[],
  key: (v: T) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const v of list) {
    const k = key(v);
    const bucket = out.get(k);
    if (bucket) bucket.push(v);
    else out.set(k, [v]);
  }
  return out;
}

function byPrefab<T extends { prefab: string }>(
  list: readonly T[],
): Map<string, T> {
  return new Map(list.map((v) => [v.prefab, v]));
}

function compareProcess(a: ValheimProcess, b: ValheimProcess): number {
  return compareText(a.processor, b.processor) || b.priority - a.priority;
}

export function buildRecipeGraph(rows: RecipeGraphRows): RecipeGraph {
  const recipesByResult = groupBy(rows.recipes, (r) => r.result);
  for (const list of recipesByResult.values()) {
    list.sort((a, b) => compareText(a.id, b.id));
  }
  const processesByOutput = groupBy(rows.processes, (p) => p.output.prefab);
  for (const list of processesByOutput.values()) list.sort(compareProcess);
  return {
    recipesByResult,
    processesByOutput,
    processors: byPrefab(rows.processors),
    stations: byPrefab(rows.stations),
    pieces: byPrefab(rows.pieces),
  };
}

/** Sets cached per API process (D5). */
export const RECIPE_GRAPH_CACHE_SIZE = 8;

export function recipeGraphCacheKey(
  setId: number | string,
  revision: number | string,
): string {
  return `${setId}:${revision}`;
}

/**
 * LRU keyed `${setId}:${revision}`. The service passes the set's
 * `imported_at` (ms) as the revision: `upsertRecipeSet` bumps it on EVERY
 * write — a same-gameVersion re-export or an equal-`capturedAt` rewrite
 * keeps the set id — so a stale graph is never served; it just ages out.
 */
export class RecipeGraphCache {
  private readonly entries = new Map<string, RecipeGraph>();

  constructor(private readonly capacity: number = RECIPE_GRAPH_CACHE_SIZE) {}

  get size(): number {
    return this.entries.size;
  }

  get(
    setId: number | string,
    revision: number | string,
  ): RecipeGraph | undefined {
    const key = recipeGraphCacheKey(setId, revision);
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  set(
    setId: number | string,
    revision: number | string,
    graph: RecipeGraph,
  ): void {
    const key = recipeGraphCacheKey(setId, revision);
    this.entries.delete(key);
    this.entries.set(key, graph);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Cached graph, else load the rows, build, cache. */
  async getOrLoad(
    setId: number | string,
    revision: number | string,
    load: () => Promise<RecipeGraphRows>,
  ): Promise<RecipeGraph> {
    const hit = this.get(setId, revision);
    if (hit) return hit;
    const graph = buildRecipeGraph(await load());
    this.set(setId, revision, graph);
    return graph;
  }
}
