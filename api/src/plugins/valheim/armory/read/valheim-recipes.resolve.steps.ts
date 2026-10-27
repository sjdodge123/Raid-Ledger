/**
 * ROK-1861 — per-quality steps of a multi-step recipe node (D1/D2) and the
 * build cost of each upgrade station a step names (D5). Steps use the node's
 * own recipe (D3), so Σ `steps[].resources` equals the node's children.
 * Pure: no Nest, no DB.
 */
import type {
  ValheimPlanStep,
  ValheimPlanVia,
  ValheimRecipe,
} from '@raid-ledger/contract';
import type { RecipeGraph } from './valheim-recipes.graph';
import {
  recipeSteps,
  recipeVia,
  type InputLine,
} from './valheim-recipes.resolve.helpers';
import {
  isUpgraderStation,
  stationAt,
  stationLevelAt,
} from './valheim-recipes.station-steps';

/** Upgrader station prefab → its piece cost (×1, never netted, never a node). */
export type StationBuilds = Map<string, InputLine[]>;

/** One entry per step `startStep..quality`; `rest` items are made / upgraded. */
export function planSteps(
  graph: RecipeGraph,
  recipe: ValheimRecipe,
  startStep: number,
  quality: number,
  rest: number,
): ValheimPlanStep[] {
  const out: ValheimPlanStep[] = [];
  for (let q = Math.max(1, startStep); q <= quality && rest > 0; q += 1) {
    const station = stationAt(recipe, q);
    out.push({
      quality: q,
      station,
      stationLevel: stationLevelAt(recipe, q),
      anyOneOf: recipe.anyOneOf,
      resources: recipeSteps(recipe, q, q, rest, graph.costRule).totals,
      upgraderStation: isUpgraderStation(graph, station),
    });
  }
  return out;
}

/** Records the piece cost of every upgrader station in `steps` that the graph can build. */
export function addStationBuilds(
  graph: RecipeGraph,
  steps: readonly ValheimPlanStep[],
  builds: StationBuilds,
): void {
  for (const { station, upgraderStation } of steps) {
    if (!upgraderStation || station === null || builds.has(station)) continue;
    const lines = (graph.pieces.get(station)?.resources ?? [])
      .filter((r) => r.amount > 0)
      .map((r) => ({ prefab: r.prefab, amount: r.amount }));
    if (lines.length > 0) builds.set(station, lines);
  }
}

/** A recipe node's `via`; D2: with `steps` only when it spans ≥ 2 quality steps. */
export function steppedVia(
  graph: RecipeGraph,
  recipe: ValheimRecipe,
  span: { startStep: number; quality: number; rest: number },
  builds: StationBuilds,
): ValheimPlanVia {
  const via = recipeVia(graph, recipe, span.quality);
  if (via.type !== 'recipe' || span.quality <= span.startStep) return via;
  const { startStep, quality, rest } = span;
  const steps = planSteps(graph, recipe, startStep, quality, rest);
  addStationBuilds(graph, steps, builds);
  return steps.length > 1 ? { ...via, steps } : via;
}
