/**
 * ROK-1854 D6 — the planner catalogue projection: item entries (recipe
 * results ∪ process outputs) named from the stored items catalogue (prefab
 * as the name when missing), every build piece, and the crafting stations.
 * Item icons index the items atlas; piece/station icons the recipe atlas.
 */
import type {
  ValheimRecipeCatalogEntry,
  ValheimRecipeStation,
} from '@raid-ledger/contract';
import type { ValheimItemCatalogEntryRow } from '../../../../drizzle/schema';
import { toCatalogIcon } from './valheim-armory-catalog.helpers';
import type { RecipeGraph } from './valheim-recipes.graph';

type CatalogItems = Record<string, ValheimItemCatalogEntryRow>;

/** Own-property lookup (`constructor` is a valid prefab id). */
function ownEntry(
  items: CatalogItems | null,
  prefab: string,
): ValheimItemCatalogEntryRow | undefined {
  if (!items || !Object.prototype.hasOwnProperty.call(items, prefab)) {
    return undefined;
  }
  return items[prefab];
}

function clampQuality(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return 1;
  return Math.min(10, Math.max(1, raw));
}

/**
 * `m_maxQuality` per prefab for the resolver's clamp: from the catalogue;
 * a piece-only prefab or an unknown one is 1 (spec §2.5).
 */
export function maxQualityLookup(
  graph: RecipeGraph,
  items: CatalogItems | null,
): (prefab: string) => number {
  return (prefab) => {
    if (!graph.recipesByResult.has(prefab)) return 1;
    return clampQuality(ownEntry(items, prefab)?.maxQuality);
  };
}

/** Sorted item prefabs that some recipe or process produces. */
export function producedPrefabs(graph: RecipeGraph): string[] {
  const set = new Set<string>([
    ...graph.recipesByResult.keys(),
    ...graph.processesByOutput.keys(),
  ]);
  return [...set].sort();
}

function itemEntry(
  graph: RecipeGraph,
  items: CatalogItems | null,
  prefab: string,
): ValheimRecipeCatalogEntry {
  const e = ownEntry(items, prefab);
  const recipes = graph.recipesByResult.get(prefab) ?? [];
  const processes = graph.processesByOutput.get(prefab) ?? [];
  return {
    prefab,
    kind: 'item',
    name: e?.name ?? prefab,
    category: e?.category ?? '',
    icon: e ? toCatalogIcon(e.icon) : null,
    maxQuality: clampQuality(e?.maxQuality),
    sources: {
      recipes: recipes.filter((r) => r.enabled).length,
      processes: processes.filter(
        (p) => graph.processors.get(p.processor)?.type !== 'incinerator',
      ).length,
    },
  };
}

/** Items (sorted by prefab) then pieces (sorted by prefab). */
export function catalogueEntries(
  graph: RecipeGraph,
  items: CatalogItems | null,
): ValheimRecipeCatalogEntry[] {
  const out = producedPrefabs(graph).map((p) => itemEntry(graph, items, p));
  const pieces = [...graph.pieces.values()].sort((a, b) =>
    a.prefab < b.prefab ? -1 : a.prefab > b.prefab ? 1 : 0,
  );
  for (const p of pieces) {
    out.push({
      prefab: p.prefab,
      kind: 'piece',
      name: p.name,
      category: p.category,
      icon: p.icon,
      maxQuality: 1,
      // A piece has exactly one build requirement list.
      sources: { recipes: 1, processes: 0 },
    });
  }
  return out;
}

/** Crafting stations, sorted by prefab. */
export function catalogueStations(graph: RecipeGraph): ValheimRecipeStation[] {
  return [...graph.stations.values()]
    .sort((a, b) => (a.prefab < b.prefab ? -1 : a.prefab > b.prefab ? 1 : 0))
    .map((s) => ({
      prefab: s.prefab,
      name: s.name,
      maxLevel: s.maxLevel,
      upgrader: s.upgrader ?? false,
      icon: s.icon,
    }));
}

/** What one prefab's sources consume: recipe/piece resources, process inputs + fuel. */
function inputsOf(graph: RecipeGraph, prefab: string): string[] {
  const out: string[] = [];
  for (const r of graph.recipesByResult.get(prefab) ?? []) {
    for (const res of r.resources) out.push(res.prefab);
  }
  for (const p of graph.processesByOutput.get(prefab) ?? []) {
    for (const i of p.inputs) out.push(i.prefab);
    const fuel = graph.processors.get(p.processor)?.fuel;
    if (fuel) out.push(fuel);
  }
  for (const res of graph.pieces.get(prefab)?.resources ?? []) {
    out.push(res.prefab);
  }
  return out;
}

/**
 * Every prefab a walk from `roots` can reach — a superset of the prefabs a
 * resolved tree/plan references, so ONE catalogue read serves both the
 * targets' `maxQuality` and the nodes' names/icons. Sorted.
 */
export function reachablePrefabs(
  graph: RecipeGraph,
  roots: readonly string[],
): string[] {
  const seen = new Set<string>();
  const todo = [...roots];
  for (let p = todo.pop(); p !== undefined; p = todo.pop()) {
    if (seen.has(p)) continue;
    seen.add(p);
    todo.push(...inputsOf(graph, p));
  }
  return [...seen].sort();
}
