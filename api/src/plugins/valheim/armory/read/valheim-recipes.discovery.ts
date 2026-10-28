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
 * Pre-0.4.2 mods stored sanitised `$…` name tokens (`_item_*`, `_piece_*`,
 * `_ship_*`, `_tool_*`, …), not prefabs. Real prefab ids never start with `_`.
 */
const LEGACY_TOKEN = /^_/;

/**
 * A list's prefab-shaped entries; null when it held entries but every one was a
 * legacy token. An empty list is usable: a brand-new character can know no
 * recipes yet (old mods sent tokens, never an empty list).
 */
export function usableEntries(list: readonly string[]): string[] | null {
  const prefabs = list.filter((e) => !LEGACY_TOKEN.test(e));
  return list.length > 0 && prefabs.length === 0 ? null : prefabs;
}

/**
 * D3 + Q1: no list → `no-character`; any list at the store cap → `truncated`
 * (a cut list is stored at exactly the cap); token-only lists are ignored and
 * token entries dropped from mixed ones — none usable left → `outdated`; else
 * the union of every usable list.
 */
export function toKnownSet(lists: readonly string[][]): KnownRecipes {
  if (lists.length === 0) return { status: 'no-character', known: null };
  if (lists.some((l) => l.length >= ARMORY_KNOWN_LIST_MAX)) {
    return { status: 'truncated', known: null };
  }
  const usable = lists
    .map(usableEntries)
    .filter((l): l is string[] => l !== null);
  if (usable.length === 0) return { status: 'outdated', known: null };
  return { status: 'known', known: new Set(usable.flat()) };
}

/** Recipes that gate an item; a disabled one cannot be learned or crafted. */
function gatingRecipes(graph: RecipeGraph, prefab: string) {
  return (graph.recipesByResult.get(prefab) ?? []).filter((r) => r.enabled);
}

/** D2: the result prefab OR any enabled recipe id producing it is listed. */
function itemKnown(
  graph: RecipeGraph,
  prefab: string,
  known: ReadonlySet<string>,
): boolean {
  if (known.has(prefab)) return true;
  return gatingRecipes(graph, prefab).some((r) => known.has(r.id));
}

/**
 * Items with no enabled recipe (process-only — even beside disabled recipes —
 * and gathered) are not gated → null.
 */
export function entryDiscovered(
  graph: RecipeGraph,
  entry: Pick<ValheimRecipeCatalogEntry, 'kind' | 'prefab'>,
  known: ReadonlySet<string> | null,
): boolean | null {
  if (known === null) return null;
  if (entry.kind === 'piece') return known.has(entry.prefab);
  if (gatingRecipes(graph, entry.prefab).length === 0) return null;
  return itemKnown(graph, entry.prefab, known);
}

/**
 * A piece's build node carries `via.recipeId === piece.prefab` (`pieceVia`);
 * an item recipe node carries one of the item's own recipe ids.
 */
function isPieceNode(
  graph: RecipeGraph,
  prefab: string,
  recipeId: string,
): boolean {
  if (!graph.pieces.has(prefab)) return false;
  const recipes = graph.recipesByResult.get(prefab) ?? [];
  return !recipes.some((r) => r.id === recipeId);
}

/**
 * Recipe nodes use the item rule (+ the node's own recipe id); piece nodes the
 * piece rule (own prefab only), same as `entryDiscovered`; others null.
 */
export function nodeDiscovered(
  graph: RecipeGraph,
  node: Pick<ValheimPlanNode, 'prefab' | 'via'>,
  known: ReadonlySet<string> | null,
): boolean | null {
  if (known === null || node.via.type !== 'recipe') return null;
  if (isPieceNode(graph, node.prefab, node.via.recipeId)) {
    return known.has(node.prefab);
  }
  if (known.has(node.via.recipeId)) return true;
  return itemKnown(graph, node.prefab, known);
}

/**
 * ROK-1860 D11: recipe options use the recipe-node rule (own id, else the item
 * rule); process options and no usable list leave them untouched.
 */
function optionsDiscovery(
  graph: RecipeGraph,
  e: ValheimRecipeCatalogEntry,
  known: ReadonlySet<string> | null,
): Pick<ValheimRecipeCatalogEntry, 'sourceOptions'> {
  if (!e.sourceOptions || known === null) return {};
  const sourceOptions = e.sourceOptions.map((o) =>
    o.ref.type === 'recipe'
      ? {
          ...o,
          discovered:
            known.has(o.ref.recipeId) || itemKnown(graph, e.prefab, known),
        }
      : o,
  );
  return { sourceOptions };
}

/** Every entry (and its recipe options) with `discovered` set (null when unknown). */
export function withEntryDiscovery(
  entries: readonly ValheimRecipeCatalogEntry[],
  graph: RecipeGraph,
  k: KnownRecipes,
): ValheimRecipeCatalogEntry[] {
  return entries.map((e) => ({
    ...e,
    discovered: entryDiscovered(graph, e, k.known),
    ...optionsDiscovery(graph, e, k.known),
  }));
}

/** Every plan/tree node with `discovered` set (null when unknown). */
export function withNodeDiscovery(
  nodes: readonly ValheimPlanNode[],
  graph: RecipeGraph,
  k: KnownRecipes,
): ValheimPlanNode[] {
  // ROK-1948 D7: a withheld leaf carries no per-viewer flag.
  return nodes.map((n) =>
    n.via.type === 'undiscovered'
      ? n
      : { ...n, discovered: nodeDiscovered(graph, n, k.known) },
  );
}
