import type {
  ValheimCraftingStation,
  ValheimPiece,
  ValheimProcess,
  ValheimProcessor,
  ValheimRecipe,
  ValheimRecipeResource,
} from '@raid-ledger/contract';
import {
  craftOf,
  directInputs,
  upgradesOf,
} from './valheim-recipes.craft.helpers';
import { buildRecipeGraph, type RecipeGraph } from './valheim-recipes.graph';
import { recipeSteps } from './valheim-recipes.resolve.helpers';

const res = (
  prefab: string,
  amount: number,
  amountPerLevel = 0,
): ValheimRecipeResource => ({
  prefab,
  amount,
  amountPerLevel,
  extraAmountOnlyOneIngredient: 0,
  recover: true,
});

function recipe(
  id: string,
  result: string,
  resources: ValheimRecipeResource[],
  over: Partial<ValheimRecipe> = {},
): ValheimRecipe {
  return {
    id,
    result,
    amount: 1,
    enabled: true,
    station: 'forge',
    repairStation: 'forge',
    minStationLevel: 1,
    upgradeOnly: false,
    anyOneOf: false,
    qualityResultAmountMultiplier: 1,
    formula: 'vanilla',
    resources,
    ...over,
  };
}

const station = (
  prefab: string,
  upgrader?: boolean,
): ValheimCraftingStation => ({
  prefab,
  name: prefab,
  maxLevel: 5,
  stackableExtension: false,
  icon: null,
  ...(upgrader === undefined ? {} : { upgrader }),
});

function processor(
  prefab: string,
  type: ValheimProcessor['type'],
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

function proc(
  processorPrefab: string,
  input: string,
  output: string,
  amount = 1,
): ValheimProcess {
  return {
    processor: processorPrefab,
    inputs: [{ prefab: input, amount: 1 }],
    anyOneOf: false,
    output: { prefab: output, amount },
    seconds: 30,
    priority: 0,
  };
}

function piece(prefab: string, over: Partial<ValheimPiece> = {}): ValheimPiece {
  return {
    prefab,
    name: prefab,
    category: 'Misc',
    tool: 'Hammer',
    station: 'piece_workbench',
    icon: null,
    resources: [{ prefab: 'Wood', amount: 10, recover: true }],
    ...over,
  };
}

const swordIron = recipe(
  'Recipe_SwordIron',
  'SwordIron',
  [res('Iron', 20, 10), res('Wood', 2)],
  {
    minStationLevel: 2,
  },
);
const blackAxe = recipe(
  'Recipe_AxeBlack',
  'AxeBlack',
  [res('BlackMetal', 10, 5)],
  {
    station: null,
    repairStation: 'blackforge_up',
  },
);

function graph(gameVersion?: string): RecipeGraph {
  return buildRecipeGraph({
    recipes: [
      recipe(
        'Recipe_ArrowWood',
        'ArrowWood',
        [res('Wood', 8), res('Feathers', 2)],
        {
          amount: 20,
          station: 'piece_workbench',
          minStationLevel: 2,
        },
      ),
      recipe('Recipe_Cape_Up', 'CapeX', [res('Hide', 4, 2)], {
        upgradeOnly: true,
      }),
      swordIron,
      blackAxe,
      recipe('Recipe_KnifeA', 'KnifeX', [res('Flint', 4)], {
        enabled: false,
        station: 'piece_workbench',
      }),
      recipe('Recipe_KnifeB', 'KnifeX', [res('Copper', 2)]),
      recipe('Recipe_Glass', 'GlassX', [res('Stone', 3)]),
    ],
    pieces: [
      piece('piece_chest'),
      piece('piece_bonfire', {
        station: null,
        resources: [
          { prefab: 'Stone', amount: 5, recover: true },
          { prefab: 'Flint', amount: 0, recover: false },
        ],
      }),
    ],
    stations: [
      station('forge'),
      station('piece_workbench'),
      station('blackforge_up', true),
    ],
    processors: [
      processor('charcoal_kiln', 'smelter'),
      processor('incinerator', 'incinerator'),
    ],
    processes: [
      proc('charcoal_kiln', 'Wood', 'Coal', 2),
      proc('incinerator', 'Wood', 'Ash'),
      proc('charcoal_kiln', 'Sand', 'GlassX'),
    ],
    ...(gameVersion === undefined ? {} : { gameVersion }),
  });
}

describe('craftOf (ROK-1899 §2.2)', () => {
  it('takes the D9 recipe at q1: station, level, output amount and q1 totals', () => {
    expect(craftOf(graph(), 'ArrowWood')).toEqual({
      via: 'recipe',
      station: 'piece_workbench',
      stationLevel: 2,
      anyOneOf: false,
      resources: [
        { prefab: 'Wood', amount: 8 },
        { prefab: 'Feathers', amount: 2 },
      ],
      amount: 20,
    });
  });

  it('gives null for an upgrade-only item, whose upgrades are non-empty', () => {
    const g = graph();
    expect(craftOf(g, 'CapeX')).toBeNull();
    expect(upgradesOf(g, 'CapeX', 3).map((u) => u.quality)).toEqual([2, 3]);
  });

  it('falls back to the first auto process with the processor as station', () => {
    expect(craftOf(graph(), 'Coal')).toEqual({
      via: 'process',
      station: 'charcoal_kiln',
      stationLevel: 0,
      anyOneOf: false,
      resources: [{ prefab: 'Wood', amount: 1 }],
      amount: 2,
    });
  });

  it('skips a disabled recipe and takes the first enabled one', () => {
    expect(craftOf(graph(), 'KnifeX')).toMatchObject({
      via: 'recipe',
      station: 'forge',
      resources: [{ prefab: 'Copper', amount: 2 }],
    });
  });

  it('prefers a recipe over a process when both make the prefab', () => {
    expect(craftOf(graph(), 'GlassX')).toMatchObject({
      via: 'recipe',
      station: 'forge',
      resources: [{ prefab: 'Stone', amount: 3 }],
    });
  });

  it('is null when only the obliterator or nothing makes the prefab', () => {
    expect(craftOf(graph(), 'Ash')).toBeNull();
    expect(craftOf(graph(), 'Wood')).toBeNull();
  });

  it('builds a piece at its station level 1, or level 0 by hand, dropping zero amounts', () => {
    const g = graph();
    expect(craftOf(g, piece('piece_chest'))).toEqual({
      via: 'piece',
      station: 'piece_workbench',
      stationLevel: 1,
      anyOneOf: false,
      resources: [{ prefab: 'Wood', amount: 10 }],
      amount: 1,
    });
    const bonfire = g.pieces.get('piece_bonfire');
    if (!bonfire) throw new Error('fixture: piece_bonfire missing');
    expect(craftOf(g, bonfire)).toMatchObject({
      station: null,
      stationLevel: 0,
      resources: [{ prefab: 'Stone', amount: 5 }],
    });
  });
});

describe('upgradesOf (ROK-1899 §2.2)', () => {
  it('matches recipeSteps(r, q, q, 1) and stationLevelAt for q2..4', () => {
    const ups = upgradesOf(graph(), 'SwordIron', 4);
    expect(ups.map((u) => [u.quality, u.stationLevel])).toEqual([
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
    expect(ups[0]?.resources).toEqual([{ prefab: 'Iron', amount: 10 }]);
    for (const u of ups) {
      expect(u.resources).toEqual(
        recipeSteps(swordIron, u.quality, u.quality, 1).totals,
      );
      expect(u.station).toBe('forge');
      expect(u.upgraderStation).toBe(false);
    }
  });

  it('follows the set cost rule (1.0.x doubles per level from q3)', () => {
    const ups = upgradesOf(graph('1.0.20'), 'SwordIron', 4);
    expect(ups.map((u) => u.resources[0]?.amount)).toEqual([10, 20, 40]);
    for (const u of ups) {
      expect(u.resources).toEqual(
        recipeSteps(swordIron, u.quality, u.quality, 1, 'v1').totals,
      );
    }
  });

  it('uses the repair station from q2 and flags an upgrader station', () => {
    expect(upgradesOf(graph(), 'AxeBlack', 2)).toEqual([
      {
        quality: 2,
        station: 'blackforge_up',
        stationLevel: 2,
        anyOneOf: false,
        resources: [{ prefab: 'BlackMetal', amount: 5 }],
        upgraderStation: true,
      },
    ]);
  });

  it('is empty for maxQuality 1, a piece and a process-only item', () => {
    const g = graph();
    expect(upgradesOf(g, 'SwordIron', 1)).toEqual([]);
    expect(upgradesOf(g, 'piece_chest', 1)).toEqual([]);
    expect(upgradesOf(g, 'Coal', 4)).toEqual([]);
  });
  it('ROK-1948 R6: on a pruned graph, upgrades stop at a station nobody has found', () => {
    const g = graph();
    const without = (drop: string) =>
      new Map([...g.stations].filter(([prefab]) => prefab !== drop));
    const pruned = (drop: string): RecipeGraph => ({
      ...g,
      stations: without(drop),
      withheld: new Set<string>(),
    });
    const qualities = (gr: RecipeGraph, prefab: string) =>
      upgradesOf(gr, prefab, 3).map((u) => u.quality);
    expect(qualities(g, 'AxeBlack')).toEqual([2, 3]);
    // Hand-made at q1, repaired at blackforge_up from q2: no step is shown.
    expect(qualities(pruned('blackforge_up'), 'AxeBlack')).toEqual([]);
    expect(qualities(pruned('forge'), 'SwordIron')).toEqual([]);
    // Another station going missing leaves this item's upgrades alone.
    expect(qualities(pruned('forge'), 'AxeBlack')).toEqual([2, 3]);
    // The FULL graph (no `withheld`) is never cut, even with a station absent.
    expect(
      qualities({ ...g, stations: without('blackforge_up') }, 'AxeBlack'),
    ).toEqual([2, 3]);
  });
});

describe('directInputs (ROK-1899 §2.2)', () => {
  it('returns the sorted, de-duplicated union of recipe, process and piece inputs', () => {
    expect(
      directInputs(graph(), [
        'ArrowWood',
        'SwordIron',
        'Coal',
        'piece_bonfire',
        'Unknown',
      ]),
    ).toEqual(['Feathers', 'Flint', 'Iron', 'Stone', 'Wood']);
  });
});
