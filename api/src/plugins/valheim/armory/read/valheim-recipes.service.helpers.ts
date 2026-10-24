/**
 * Pure response-shaping helpers for `ValheimRecipesService` (split out to
 * keep the service under its size limit). ROK-1862 D6: discovery is applied
 * here, per request, AFTER the shared cross-viewer graph — never inside it.
 */
import type { AuthenticatedUser } from '../../../../auth/types';
import { projectCatalog } from './valheim-armory-catalog.helpers';
import { toMaterialsViewer } from './valheim-materials.privacy';
import {
  toKnownSet,
  withNodeDiscovery,
  type KnownRecipes,
} from './valheim-recipes.discovery';
import type { ValheimRecipeSetRow } from '../../../../drizzle/schema';
import {
  maxQualityLookup,
  reachablePrefabs,
} from './valheim-recipes.catalog.helpers';
import type { RecipeGraph } from './valheim-recipes.graph';
import type { RecipesReader } from './valheim-recipes.read.repository';
import type { ResolveResult } from './valheim-recipes.resolve';

/** D4: the viewer's merged `known_recipes` on `serverId` (one read). */
export async function knownFor(
  r: RecipesReader,
  serverId: number,
  user: AuthenticatedUser,
): Promise<KnownRecipes> {
  return toKnownSet(await r.knownRecipesFor(serverId, toMaterialsViewer(user)));
}

/** Catalogue subset for every prefab the resolved nodes reference. */
export function nodeCatalog(
  res: ResolveResult,
  cat: Parameters<typeof projectCatalog>[1],
) {
  const prefabs = [...new Set(res.nodes.map((n) => n.prefab))].sort();
  const { items, atlas } = projectCatalog(prefabs, cat);
  return { items, itemAtlas: atlas };
}

/** The resolved nodes with `discovered` set, plus the response status. */
export function pickTree(
  res: ResolveResult,
  graph: RecipeGraph,
  k: KnownRecipes,
) {
  return {
    nodes: withNodeDiscovery(res.nodes, graph, k),
    truncated: res.truncated,
    discovery: k.status,
  };
}

/**
 * ONE items-catalogue read (D6 choice) for everything reachable from
 * `roots`: the targets' `maxQuality` and, after resolving, the nodes'
 * names + icons.
 */
export async function catalogFor(
  r: RecipesReader,
  set: ValheimRecipeSetRow,
  graph: RecipeGraph,
  roots: string[],
) {
  const cat = await r.materials.findCatalog(
    set.pelicanServerId,
    set.gameVersion,
    reachablePrefabs(graph, roots),
  );
  return { cat, maxQ: maxQualityLookup(graph, cat?.items ?? null) };
}
