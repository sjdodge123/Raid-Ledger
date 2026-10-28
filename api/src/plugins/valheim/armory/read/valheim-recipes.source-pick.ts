/**
 * ROK-1854 D9 source choice, extracted for ROK-1860: the candidate list of
 * one node, its rank, and the pick — which honours a per-prefab source
 * override (the Planner source picker) only when that override names one of
 * the node's own candidates (D4); anything else falls back to D9 silently.
 */
import type {
  ValheimProcess,
  ValheimProcessor,
  ValheimProcessorType,
  ValheimRecipe,
  ValheimRecipeSourceRef,
} from '@raid-ledger/contract';
import type { RecipeGraph } from './valheim-recipes.graph';
import { shownRecipes } from './valheim-recipes.station-steps';

export interface ProcessSource {
  process: ValheimProcess;
  processor: ValheimProcessor;
}

export type PlanSource =
  | { type: 'recipe'; recipe: ValheimRecipe }
  | ({ type: 'process' } & ProcessSource);

/** D9 / ROK-1860 D5: the obliterator (`incinerator`) is never picked nor honoured. */
export const AUTO_PROCESSORS: ReadonlySet<ValheimProcessorType> = new Set([
  'smelter',
  'fermenter',
  'cooking',
]);

/** D9 rank: crafting recipe > upgrade-only recipe > process. */
export function sourceRank(s: PlanSource): number {
  if (s.type === 'process') return 2;
  return s.recipe.upgradeOnly ? 1 : 0;
}

/** ROK-1948 R6: recipes at a hidden per-quality station are dropped BEFORE D9 ranks. */
export function candidates(
  graph: RecipeGraph,
  prefab: string,
  startStep: number,
  quality: number,
): { list: PlanSource[]; hidden: boolean } {
  const valid = (graph.recipesByResult.get(prefab) ?? []).filter(
    (r) => r.enabled && (!r.upgradeOnly || startStep >= 2),
  );
  const { shown, hidden } = shownRecipes(graph, valid, startStep, quality);
  const list = shown.map((recipe): PlanSource => ({ type: 'recipe', recipe }));
  if (quality > 1) return { list, hidden };
  for (const process of graph.processesByOutput.get(prefab) ?? []) {
    const processor = graph.processors.get(process.processor);
    if (processor && AUTO_PROCESSORS.has(processor.type))
      list.push({ type: 'process', process, processor });
  }
  return { list, hidden };
}

/**
 * ROK-1860 D2: a process's `index` = its position among the `prefab`'s
 * processes run by that same processor, graph order.
 */
export function processIndex(
  graph: RecipeGraph,
  prefab: string,
  process: ValheimProcess,
): number {
  return (graph.processesByOutput.get(prefab) ?? [])
    .filter((p) => p.processor === process.processor)
    .indexOf(process);
}

/** True when `ref` names `source` (a candidate of `prefab`). */
export function sameSource(
  ref: ValheimRecipeSourceRef,
  source: PlanSource,
  graph: RecipeGraph,
  prefab: string,
): boolean {
  if (ref.type === 'recipe')
    return source.type === 'recipe' && source.recipe.id === ref.recipeId;
  return (
    source.type === 'process' &&
    AUTO_PROCESSORS.has(source.processor.type) &&
    source.processor.prefab === ref.processor &&
    processIndex(graph, prefab, source.process) === ref.index
  );
}

export interface SourcePick {
  source: PlanSource | null;
  alternatives: number;
  /** ROK-1948 R6: a recipe was dropped because a step's station is hidden. */
  hidden: boolean;
}

/**
 * The `override` when it is one of this node's candidates (D4), else the
 * first source by D9 rank; ties keep the graph's `id` / processor-prefab order.
 */
export function pickSource(
  graph: RecipeGraph,
  prefab: string,
  startStep: number,
  quality: number,
  override?: ValheimRecipeSourceRef,
): SourcePick {
  const { list, hidden } = candidates(graph, prefab, startStep, quality);
  const chosen = override
    ? list.find((s) => sameSource(override, s, graph, prefab))
    : undefined;
  const ranked = list
    .map((source, i) => ({ source, i }))
    .sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || a.i - b.i);
  return {
    source: chosen ?? ranked[0]?.source ?? null,
    alternatives: Math.max(0, list.length - 1),
    hidden,
  };
}
