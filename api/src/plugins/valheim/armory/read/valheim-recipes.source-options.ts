/**
 * ROK-1860 D6 — the catalogue's `sourceOptions` for one item: every source
 * the resolver could use at step 1 / quality 1, built from the SAME
 * `candidates()` on the SAME (spoiler-pruned) graph, so a hidden source
 * (ROK-1948) is never offered and the incinerator never is (D5). Ranked by
 * D9; exactly one `default` (the pick with no override). Omitted below 2.
 */
import type {
  ValheimRecipeSourceOption,
  ValheimRecipeSourceRef,
} from '@raid-ledger/contract';
import { positive } from './valheim-recipes.craft.helpers';
import type { RecipeGraph } from './valheim-recipes.graph';
import {
  recipeSteps,
  stationAt,
  stationLevelAt,
} from './valheim-recipes.resolve.helpers';
import {
  candidates,
  pickSource,
  processIndex,
  sameSource,
  sourceRank,
  type PlanSource,
} from './valheim-recipes.source-pick';

/** `ValheimRecipeSourceOptionsSchema` max. */
const OPTIONS_MAX = 16;

/** The `sources=` ref that names `s` (D3). */
export function sourceRefOf(
  graph: RecipeGraph,
  prefab: string,
  s: PlanSource,
): ValheimRecipeSourceRef {
  if (s.type === 'recipe') return { type: 'recipe', recipeId: s.recipe.id };
  return {
    type: 'process',
    processor: s.processor.prefab,
    index: processIndex(graph, prefab, s.process),
  };
}

function optionOf(
  graph: RecipeGraph,
  prefab: string,
  s: PlanSource,
  isDefault: boolean,
): ValheimRecipeSourceOption {
  const ref = sourceRefOf(graph, prefab, s);
  if (s.type === 'process') {
    return {
      ref,
      station: s.processor.prefab,
      stationLevel: 0,
      processorType: s.processor.type,
      outputAmount: s.process.output.amount,
      upgradeOnly: false,
      resources: positive(s.process.inputs),
      default: isDefault,
    };
  }
  const r = s.recipe;
  return {
    ref,
    station: stationAt(r, 1),
    stationLevel: stationLevelAt(r, 1),
    outputAmount: r.amount,
    upgradeOnly: r.upgradeOnly,
    resources: positive(recipeSteps(r, 1, 1, r.amount, graph.costRule).totals),
    default: isDefault,
  };
}

/** D6: the offered sources of `prefab`, D9 order; undefined when fewer than 2. */
export function sourceOptionsOf(
  graph: RecipeGraph,
  prefab: string,
): ValheimRecipeSourceOption[] | undefined {
  const { list } = candidates(graph, prefab, 1, 1);
  if (list.length < 2) return undefined;
  const chosen = pickSource(graph, prefab, 1, 1).source;
  const def = chosen ? sourceRefOf(graph, prefab, chosen) : null;
  const isDefault = (s: PlanSource) =>
    def !== null && sameSource(def, s, graph, prefab);
  return list
    .map((source, i) => ({ source, i }))
    .sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || a.i - b.i)
    .slice(0, OPTIONS_MAX)
    .map(({ source }) => optionOf(graph, prefab, source, isDefault(source)));
}
