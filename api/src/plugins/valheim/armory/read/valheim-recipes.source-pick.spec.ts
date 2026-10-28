/**
 * ROK-1860 D4/D5 — a per-prefab source override is honoured only when it
 * names one of the node's own candidates; anything else falls back to D9
 * silently (AC3). No override → the D9 pick (AC1).
 */
import type {
  ValheimPlanNode,
  ValheimProcess,
  ValheimProcessor,
  ValheimProcessorType,
  ValheimRecipe,
  ValheimRecipeSourceRef,
} from '@raid-ledger/contract';
import { RECIPES_DEMO_MESSAGE as DEMO } from '../valheim-armory-recipes-demo-fixture';
import { buildRecipeGraph, type RecipeGraph } from './valheim-recipes.graph';
import { resolveTree } from './valheim-recipes.resolve';
import { pickSource } from './valheim-recipes.source-pick';

function recipe(
  id: string,
  input: string,
  over: Partial<ValheimRecipe> = {},
): ValheimRecipe {
  return {
    id,
    result: 'Bar',
    amount: 1,
    enabled: true,
    station: null,
    repairStation: null,
    minStationLevel: 1,
    upgradeOnly: false,
    anyOneOf: false,
    qualityResultAmountMultiplier: 1,
    formula: 'vanilla',
    resources: [
      {
        prefab: input,
        amount: 2,
        amountPerLevel: 1,
        extraAmountOnlyOneIngredient: 0,
        recover: true,
      },
    ],
    ...over,
  };
}

function processor(
  prefab: string,
  type: ValheimProcessorType,
): ValheimProcessor {
  return {
    prefab,
    type,
    fuel: null,
    fuelPerProduct: null,
    fuelSecondsPerUnit: null,
    windPowered: false,
    requiresRoof: false,
    maxInput: null,
    burntResult: null,
    defaultResult: null,
  };
}

function proc(by: string, input: string, priority: number): ValheimProcess {
  return {
    processor: by,
    inputs: [{ prefab: input, amount: 1 }],
    anyOneOf: false,
    output: { prefab: 'Bar', amount: 1 },
    seconds: 30,
    priority,
  };
}

// Recipes sort by id (D9 default = Recipe_Bar); smelter processes by priority desc.
const graph = buildRecipeGraph({
  recipes: [
    recipe('Recipe_Bar', 'Ore'),
    recipe('Recipe_Bar_Alt', 'Scrap'),
    recipe('Recipe_Bar_Off', 'Gem', { enabled: false }),
  ],
  pieces: [],
  stations: [],
  processors: [
    processor('smelter', 'smelter'),
    processor('obliterator', 'incinerator'),
  ],
  processes: [
    proc('smelter', 'Ore', 1),
    proc('smelter', 'Scrap', 0),
    proc('obliterator', 'Junk', 0),
  ],
});

const rec = (recipeId: string): ValheimRecipeSourceRef => ({
  type: 'recipe',
  recipeId,
});
const smelt = (processor: string, index: number): ValheimRecipeSourceRef => ({
  type: 'process',
  processor,
  index,
});

function tree(
  g: RecipeGraph,
  ref: ValheimRecipeSourceRef | null,
  quality = 1,
): ValheimPlanNode[] {
  const target = { prefab: 'Bar', quality, amount: 1, fromQuality: 0 };
  const sources = new Map(ref ? [['Bar', ref]] : []);
  return resolveTree(g, target, null, { maxQuality: () => 2, sources }).nodes;
}

/** `prefab:via[:recipeId|processor]` per node. */
function shape(nodes: ValheimPlanNode[]): string[] {
  return nodes.map((n) => {
    const v = n.via;
    const tag =
      v.type === 'recipe'
        ? `:${v.recipeId}`
        : v.type === 'process'
          ? `:${v.processor}`
          : '';
    return `${n.prefab}:${v.type}${tag}`;
  });
}

const D9 = ['Bar:recipe:Recipe_Bar', 'Ore:gathered'];

describe('ROK-1860 pickSource override — honoured', () => {
  it('no override keeps the D9 pick (AC1)', () => {
    expect(shape(tree(graph, null))).toEqual(D9);
  });

  it('a recipe override swaps the recipe and its children', () => {
    expect(shape(tree(graph, rec('Recipe_Bar_Alt')))).toEqual([
      'Bar:recipe:Recipe_Bar_Alt',
      'Scrap:gathered',
    ]);
  });

  it('a process override picks that processor at that index', () => {
    expect(shape(tree(graph, smelt('smelter', 0)))).toEqual([
      'Bar:process:smelter',
      'Ore:gathered',
    ]);
    expect(shape(tree(graph, smelt('smelter', 1)))).toEqual([
      'Bar:process:smelter',
      'Scrap:gathered',
    ]);
  });

  it('keeps the candidate count as alternatives', () => {
    const pick = pickSource(graph, 'Bar', 1, 1, rec('Recipe_Bar_Alt'));
    expect(pick.alternatives).toBe(3);
  });
});

describe('ROK-1860 pickSource override — falls back to D9 silently (AC3)', () => {
  it('a disabled recipe', () => {
    expect(shape(tree(graph, rec('Recipe_Bar_Off')))).toEqual(D9);
  });

  it('an unknown recipe id', () => {
    expect(shape(tree(graph, rec('Recipe_Nope')))).toEqual(D9);
  });

  it('a process index past the end', () => {
    expect(shape(tree(graph, smelt('smelter', 2)))).toEqual(D9);
  });

  it('the incinerator / obliterator (D5)', () => {
    expect(shape(tree(graph, smelt('obliterator', 0)))).toEqual(D9);
  });

  it('a process at quality > 1', () => {
    expect(shape(tree(graph, smelt('smelter', 0), 2))[0]).toBe(
      'Bar:recipe:Recipe_Bar',
    );
  });

  it('a recipe at a hidden station (ROK-1948 R6)', () => {
    const [bench] = DEMO.stations;
    if (!bench) throw new Error('demo set has no station');
    const hidden = buildRecipeGraph({
      recipes: [
        recipe('Recipe_Bar', 'Ore', { station: bench.prefab }),
        recipe('Recipe_Bar_Forge', 'Scrap', { station: 'forge' }),
      ],
      pieces: [],
      stations: [bench],
      processors: [],
      processes: [],
    });
    const pruned: RecipeGraph = { ...hidden, withheld: new Set<string>() };
    expect(shape(tree(hidden, rec('Recipe_Bar_Forge')))[0]).toBe(
      'Bar:recipe:Recipe_Bar_Forge',
    );
    expect(shape(tree(pruned, rec('Recipe_Bar_Forge')))).toEqual(D9);
  });
});
