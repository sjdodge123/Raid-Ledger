/**
 * ROK-1862 D2/D3/D6 — "has the viewer's character discovered this recipe?".
 * Pure: computed per request AFTER the shared (cross-viewer) recipe graph,
 * never stored in it. `discovered: null` = not gated (process-only and
 * gathered outputs) or unknown (no character, list truncated).
 */
import type {
  ValheimPlanNode,
  ValheimRecipeCatalogEntry,
  ValheimRecipeDiscovery,
} from '@raid-ledger/contract';
import { ARMORY_KNOWN_LIST_MAX } from '../valheim-armory.mappers';
import type { RecipeGraph } from './valheim-recipes.graph';

/** The viewer's merged known list, or null when it cannot be trusted. */
export interface KnownRecipes {
  status: ValheimRecipeDiscovery;
  known: Set<string> | null;
}

/**
 * D3 + Q1: no list → `no-character`; any list at the store cap → `truncated`
 * (a cut list is stored at exactly the cap); else the union of every list.
 */
export function toKnownSet(lists: readonly string[][]): KnownRecipes {
  if (lists.length === 0) return { status: 'no-character', known: null };
  if (lists.some((l) => l.length >= ARMORY_KNOWN_LIST_MAX)) {
    return { status: 'truncated', known: null };
  }
  return { status: 'known', known: new Set(lists.flat()) };
}

/** D2: the result prefab OR any recipe id producing it is in the list. */
function itemKnown(
  graph: RecipeGraph,
  prefab: string,
  known: ReadonlySet<string>,
): boolean {
  if (known.has(prefab)) return true;
  const recipes = graph.recipesByResult.get(prefab) ?? [];
  return recipes.some((r) => known.has(r.id));
}

/** Items with no recipe (process-only, gathered) are not gated → null. */
export function entryDiscovered(
  graph: RecipeGraph,
  entry: Pick<ValheimRecipeCatalogEntry, 'kind' | 'prefab'>,
  known: ReadonlySet<string> | null,
): boolean | null {
  if (known === null) return null;
  if (entry.kind === 'piece') return known.has(entry.prefab);
  const recipes = graph.recipesByResult.get(entry.prefab) ?? [];
  if (recipes.length === 0) return null;
  return itemKnown(graph, entry.prefab, known);
}

/** Recipe nodes use the item rule (+ the node's own recipe id); others null. */
export function nodeDiscovered(
  graph: RecipeGraph,
  node: Pick<ValheimPlanNode, 'prefab' | 'via'>,
  known: ReadonlySet<string> | null,
): boolean | null {
  if (known === null || node.via.type !== 'recipe') return null;
  if (known.has(node.via.recipeId)) return true;
  return itemKnown(graph, node.prefab, known);
}

/** Every entry with `discovered` set (null when unknown). */
export function withEntryDiscovery(
  entries: readonly ValheimRecipeCatalogEntry[],
  graph: RecipeGraph,
  k: KnownRecipes,
): ValheimRecipeCatalogEntry[] {
  return entries.map((e) => ({
    ...e,
    discovered: entryDiscovered(graph, e, k.known),
  }));
}

/** Every plan/tree node with `discovered` set (null when unknown). */
export function withNodeDiscovery(
  nodes: readonly ValheimPlanNode[],
  graph: RecipeGraph,
  k: KnownRecipes,
): ValheimPlanNode[] {
  return nodes.map((n) => ({
    ...n,
    discovered: nodeDiscovered(graph, n, k.known),
  }));
}
