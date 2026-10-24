/**
 * ROK-1854 §1.2 per-quality station rules, plus the ROK-1948 R6 visibility
 * check the source choice filters on. Pure; re-exported by the resolver's
 * helpers so their callers keep one import.
 */
import type { ValheimRecipe } from '@raid-ledger/contract';
import type { RecipeGraph } from './valheim-recipes.graph';

/** §1.2 `stationLevel(R, q)`. */
export function stationLevelAt(recipe: ValheimRecipe, q: number): number {
  return Math.max(1, recipe.minStationLevel) + (q - 1);
}

/** §1.2 `station(R, q)`. */
export function stationAt(recipe: ValheimRecipe, q: number): string | null {
  return recipe.station ?? (q > 1 ? recipe.repairStation : null);
}

/**
 * ROK-1948 R6: on a spoiler-pruned graph, true when a step `from..to` of
 * `recipe` needs a station nobody has found. The full graph (no `withheld`)
 * is never affected.
 */
export function hidesStep(
  graph: RecipeGraph,
  recipe: ValheimRecipe,
  from: number,
  to: number,
): boolean {
  if (!graph.withheld) return false;
  for (let q = Math.max(from, 1); q <= to; q += 1) {
    const s = stationAt(recipe, q);
    if (s !== null && !graph.stations.has(s)) return true;
  }
  return false;
}

/** `recipes` minus any with a step `from..to` at a hidden station; `hidden` = one was dropped. */
export function shownRecipes(
  graph: RecipeGraph,
  recipes: readonly ValheimRecipe[],
  from: number,
  to: number,
): { shown: ValheimRecipe[]; hidden: boolean } {
  const shown = recipes.filter((r) => !hidesStep(graph, r, from, to));
  return { shown, hidden: shown.length < recipes.length };
}
