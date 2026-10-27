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

type CatalogItemMap = ReturnType<typeof projectCatalog>['items'];

/**
 * ROK-1948 (operator ruling 2026-10-24): a withheld prefab may be NAMED as an
 * ingredient (name + icon, like the game) but carries nothing else.
 */
export function nameAndIconOnly(
  items: CatalogItemMap,
  graph: RecipeGraph,
): CatalogItemMap {
  const hidden = graph.withheld;
  if (!hidden) return items;
  return Object.fromEntries(
    Object.entries(items).map(([prefab, e]) => [
      prefab,
      hidden.has(prefab) ? { name: e.name, category: '', icon: e.icon } : e,
    ]),
  );
}

/**
 * Every prefab a response names: the nodes, ROK-1861 step resources and the
 * upgrade-station builds (station + its piece cost). All come from the
 * spoiler-pruned graph, so none names an undiscovered station. Sorted.
 */
export function responsePrefabs(res: ResolveResult): string[] {
  const out = new Set(res.nodes.map((n) => n.prefab));
  for (const { via } of res.nodes) {
    if (via.type !== 'recipe') continue;
    for (const s of via.steps ?? [])
      for (const r of s.resources) out.add(r.prefab);
  }
  for (const [station, lines] of res.stationBuilds) {
    out.add(station);
    for (const l of lines) out.add(l.prefab);
  }
  return [...out].sort();
}

/** ROK-1861 D5: `stationBuilds` for a response, omitted when there are none. */
export function buildsOf(res: ResolveResult) {
  if (res.stationBuilds.size === 0) return {};
  return { stationBuilds: Object.fromEntries(res.stationBuilds) };
}

/**
 * ROK-1861: catalogue-read roots — `roots` plus every upgrade station the
 * (pruned) graph can build, so a build's materials get names and icons.
 */
export function catalogRoots(graph: RecipeGraph, roots: string[]): string[] {
  const builds = [...graph.stations.values()]
    .filter((s) => s.upgrader && graph.pieces.has(s.prefab))
    .map((s) => s.prefab);
  return [...roots, ...builds];
}

/** Catalogue subset for every prefab the resolved response references. */
export function nodeCatalog(
  res: ResolveResult,
  cat: Parameters<typeof projectCatalog>[1],
  graph: RecipeGraph,
) {
  const { items, atlas } = projectCatalog(responsePrefabs(res), cat);
  return { items: nameAndIconOnly(items, graph), itemAtlas: atlas };
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
    reachablePrefabs(graph, catalogRoots(graph, roots)),
  );
  return { cat, maxQ: maxQualityLookup(graph, cat?.items ?? null) };
}
