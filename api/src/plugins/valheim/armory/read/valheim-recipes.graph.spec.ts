import type { ValheimProcess, ValheimRecipe } from '@raid-ledger/contract';
import {
  RECIPE_GRAPH_CACHE_SIZE,
  RecipeGraphCache,
  buildRecipeGraph,
  type RecipeGraphRows,
} from './valheim-recipes.graph';

function recipe(id: string, result: string): ValheimRecipe {
  return {
    id,
    result,
    amount: 1,
    enabled: true,
    station: null,
    repairStation: null,
    minStationLevel: 1,
    upgradeOnly: false,
    anyOneOf: false,
    qualityResultAmountMultiplier: 1,
    formula: 'vanilla',
    resources: [],
  };
}

function process(
  processor: string,
  output: string,
  priority: number,
): ValheimProcess {
  return {
    processor,
    inputs: [{ prefab: 'Ore', amount: 1 }],
    anyOneOf: false,
    output: { prefab: output, amount: 1 },
    seconds: 30,
    priority,
  };
}

function rows(over: Partial<RecipeGraphRows> = {}): RecipeGraphRows {
  return {
    recipes: [],
    pieces: [],
    stations: [],
    processors: [],
    processes: [],
    ...over,
  };
}

describe('buildRecipeGraph', () => {
  it('groups recipes by result, sorted by id (D9 tie order)', () => {
    const graph = buildRecipeGraph(
      rows({
        recipes: [
          recipe('c', 'Sword'),
          recipe('a', 'Sword'),
          recipe('b', 'Axe'),
        ],
      }),
    );
    expect(graph.recipesByResult.get('Sword')?.map((r) => r.id)).toEqual([
      'a',
      'c',
    ]);
    expect(graph.recipesByResult.get('Axe')?.map((r) => r.id)).toEqual(['b']);
    expect(graph.recipesByResult.has('Ore')).toBe(false);
  });

  it('groups processes by output, sorted by processor prefab then priority desc', () => {
    const graph = buildRecipeGraph(
      rows({
        processes: [
          process('smelter', 'Copper', 0),
          process('blast_furnace', 'Copper', 1),
          process('blast_furnace', 'Copper', 5),
        ],
      }),
    );
    expect(
      graph.processesByOutput
        .get('Copper')
        ?.map((p) => `${p.processor}:${p.priority}`),
    ).toEqual(['blast_furnace:5', 'blast_furnace:1', 'smelter:0']);
  });

  it('indexes stations, processors and pieces by prefab', () => {
    const graph = buildRecipeGraph(
      rows({
        stations: [
          {
            prefab: 'forge',
            name: 'Forge',
            maxLevel: 7,
            stackableExtension: false,
            icon: null,
          },
        ],
        processors: [
          {
            prefab: 'smelter',
            type: 'smelter',
            fuel: 'Coal',
            fuelPerProduct: 2,
            fuelSecondsPerUnit: null,
            windPowered: false,
            requiresRoof: false,
            maxInput: 10,
            burntResult: null,
            defaultResult: null,
          },
        ],
        pieces: [
          {
            prefab: 'wood_wall',
            name: 'Wood wall',
            category: 'Building',
            tool: 'Hammer',
            station: null,
            icon: null,
            resources: [],
          },
        ],
      }),
    );
    expect(graph.stations.get('forge')?.maxLevel).toBe(7);
    expect(graph.processors.get('smelter')?.fuel).toBe('Coal');
    expect(graph.pieces.get('wood_wall')?.name).toBe('Wood wall');
  });
});

describe('RecipeGraphCache', () => {
  const graph = buildRecipeGraph(rows());

  it('keys on set id AND source snapshot id', () => {
    const cache = new RecipeGraphCache();
    cache.set(1, 10, graph);
    expect(cache.get(1, 10)).toBe(graph);
    expect(cache.get(1, 11)).toBeUndefined();
    expect(cache.get(2, 10)).toBeUndefined();
  });

  it(`holds ${RECIPE_GRAPH_CACHE_SIZE} sets and evicts the least recently used`, () => {
    expect(RECIPE_GRAPH_CACHE_SIZE).toBe(8);
    const cache = new RecipeGraphCache();
    for (let i = 1; i <= 8; i += 1) cache.set(i, 1, buildRecipeGraph(rows()));
    expect(cache.get(1, 1)).toBeDefined(); // set 1 is now the most recent
    cache.set(9, 1, graph);
    expect(cache.size).toBe(8);
    expect(cache.get(2, 1)).toBeUndefined();
    expect(cache.get(1, 1)).toBeDefined();
    expect(cache.get(9, 1)).toBe(graph);
  });

  it('getOrLoad builds once, then serves the cached graph', async () => {
    const cache = new RecipeGraphCache();
    const load = jest.fn(() =>
      Promise.resolve(rows({ recipes: [recipe('a', 'Sword')] })),
    );
    const first = await cache.getOrLoad(3, 'snap', load);
    const second = await cache.getOrLoad(3, 'snap', load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first.recipesByResult.get('Sword')?.[0]?.id).toBe('a');
  });

  it('a new revision of the same set (a re-import bumps imported_at) reloads', async () => {
    const cache = new RecipeGraphCache();
    const before = await cache.getOrLoad(3, 1_000, () =>
      Promise.resolve(rows({ recipes: [recipe('a', 'Sword')] })),
    );
    const after = await cache.getOrLoad(3, 1_001, () =>
      Promise.resolve(rows({ recipes: [] })),
    );
    expect(before.recipesByResult.has('Sword')).toBe(true);
    expect(after.recipesByResult.has('Sword')).toBe(false);
  });
});
