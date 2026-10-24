/**
 * ROK-1948 D5 — the spoiler-pruned graph, cached per server per scan. The
 * shared `RecipeGraphCache` keeps the FULL graph; this LRU keeps the pruned
 * copy alongside it, keyed `${serverId}:${setId}:${setRevision}:${profiles}`
 * where `profiles` is the server's profile fingerprint (count + newest
 * `imported_at`). Nothing about the viewer — id, role, claim, impersonation —
 * is in the key or the build, so every viewer gets the same graph.
 */
import type {
  ValheimRecipeCatalogEntry,
  ValheimRecipeSpoilers,
  ValheimRecipeStation,
} from '@raid-ledger/contract';
import type { ValheimRecipeSetRow } from '../../../../drizzle/schema';
import {
  RECIPE_GRAPH_CACHE_SIZE,
  type RecipeGraph,
} from './valheim-recipes.graph';
import type { RecipesReader } from './valheim-recipes.read.repository';
import { catalogueStations } from './valheim-recipes.catalog.helpers';
import {
  clampStationLevels,
  serverKnown,
  spoilerGraph,
} from './valheim-recipes.spoilers';

/** The graph every projection runs on, and the response-level status. */
export interface VisibleRecipes {
  graph: RecipeGraph;
  spoilers: ValheimRecipeSpoilers;
}

export class VisibleGraphCache {
  private readonly entries = new Map<string, VisibleRecipes>();

  constructor(private readonly capacity: number = RECIPE_GRAPH_CACHE_SIZE) {}

  get size(): number {
    return this.entries.size;
  }

  /** Cached entry for `key`, else build, cache (LRU), return. */
  async getOrBuild(
    key: string,
    build: () => Promise<VisibleRecipes>,
  ): Promise<VisibleRecipes> {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const built = await build();
    this.entries.set(key, built);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return built;
  }
}

/** The server-wide status alone (no set yet → nothing to prune). */
export async function serverSpoilers(
  r: RecipesReader,
  serverId: number,
): Promise<ValheimRecipeSpoilers> {
  return serverKnown(await r.serverKnownLists(serverId)).status;
}

/** `full` pruned to what anyone on the set's server has discovered. */
export async function visibleRecipes(
  cache: VisibleGraphCache,
  r: RecipesReader,
  set: ValheimRecipeSetRow,
  full: RecipeGraph,
): Promise<VisibleRecipes> {
  const serverId = set.pelicanServerId;
  const fp = await r.profileFingerprint(serverId);
  const key = `${serverId}:${set.id}:${set.importedAt.getTime()}:${fp}`;
  return cache.getOrBuild(key, async () => {
    const known = serverKnown(await r.serverKnownLists(serverId));
    return { graph: spoilerGraph(full, known), spoilers: known.status };
  });
}

/** Catalogue stations; while protected the `★ max N` badge is clamped (Q4). */
export function shownStations(
  graph: RecipeGraph,
  entries: readonly ValheimRecipeCatalogEntry[],
  spoilers: ValheimRecipeSpoilers,
): ValheimRecipeStation[] {
  const stations = catalogueStations(graph);
  if (spoilers !== 'protected') return stations;
  return clampStationLevels(stations, entries);
}
