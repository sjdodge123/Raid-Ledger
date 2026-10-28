/**
 * ROK-1860 D6 / AC5 — the catalogue's `sourceOptions`: built from the same
 * candidates the resolver uses, D9-ranked, one `default`, omitted below 2,
 * never the incinerator, never a hidden (ROK-1948 R6) source.
 */
import type { ValheimRecipe } from '@raid-ledger/contract';
import { RECIPES_DEMO_MESSAGE as DEMO } from '../valheim-armory-recipes-demo-fixture';
import { catalogueEntries } from './valheim-recipes.catalog.helpers';
import { buildRecipeGraph, type RecipeGraph } from './valheim-recipes.graph';
import { pickSource } from './valheim-recipes.source-pick';
import { sourceOptionsOf, sourceRefOf } from './valheim-recipes.source-options';

const demo = buildRecipeGraph({ ...DEMO, gameVersion: DEMO.gameVersion });

function must<T>(x: T | undefined, label: string): T {
  if (x === undefined) throw new Error(`demo set has no ${label}`);
  return x;
}

function recipeOf(id: string): ValheimRecipe {
  const r = DEMO.recipes.find((x) => x.id === id);
  if (!r) throw new Error(`demo set has no ${id}`);
  return r;
}

describe('sourceOptionsOf', () => {
  it('Bronze: both forge recipes, D9 first and the only default', () => {
    expect(sourceOptionsOf(demo, 'Bronze')).toEqual([
      {
        ref: { type: 'recipe', recipeId: 'Recipe_Bronze' },
        station: 'forge',
        stationLevel: 1,
        outputAmount: 1,
        upgradeOnly: false,
        resources: [
          { prefab: 'Copper', amount: 2 },
          { prefab: 'Tin', amount: 1 },
        ],
        default: true,
      },
      {
        ref: { type: 'recipe', recipeId: 'Recipe_Bronze5' },
        station: 'forge',
        stationLevel: 2,
        outputAmount: 5,
        upgradeOnly: false,
        resources: [
          { prefab: 'Copper', amount: 8 },
          { prefab: 'Tin', amount: 3 },
        ],
        default: false,
      },
    ]);
  });

  it('Coal: the kiln processes by index, the first one default', () => {
    expect(sourceOptionsOf(demo, 'Coal')).toEqual([
      expect.objectContaining({
        ref: { type: 'process', processor: 'charcoal_kiln', index: 0 },
        station: 'charcoal_kiln',
        stationLevel: 0,
        processorType: 'smelter',
        resources: [{ prefab: 'Wood', amount: 1 }],
        default: true,
      }),
      expect.objectContaining({
        ref: { type: 'process', processor: 'charcoal_kiln', index: 1 },
        resources: [{ prefab: 'RoundLog', amount: 1 }],
        default: false,
      }),
    ]);
  });

});

describe('sourceOptionsOf default + rank', () => {
  it('the default ref is exactly what pickSource chooses with no override', () => {
    for (const prefab of ['Bronze', 'Coal']) {
      const pick = pickSource(demo, prefab, 1, 1).source;
      if (!pick) throw new Error(`no D9 pick for ${prefab}`);
      const defaults = (sourceOptionsOf(demo, prefab) ?? []).filter(
        (o) => o.default,
      );
      expect(defaults.map((o) => o.ref)).toEqual([
        sourceRefOf(demo, prefab, pick),
      ]);
    }
  });

  it('a recipe outranks a process even when listed after it', () => {
    const g = buildRecipeGraph({
      ...DEMO,
      recipes: [{ ...recipeOf('Recipe_Club'), result: 'Coal', id: 'Z_Coal' }],
    });
    expect(
      (sourceOptionsOf(g, 'Coal') ?? []).map((o) => [o.ref.type, o.default]),
    ).toEqual([
      ['recipe', true],
      ['process', false],
      ['process', false],
    ]);
  });

});

describe('sourceOptionsOf exclusions', () => {
  it('single-source items are omitted', () => {
    for (const prefab of ['Club', 'Copper', 'SwordBronze', 'Cultivator']) {
      expect({ prefab, options: sourceOptionsOf(demo, prefab) }).toEqual({
        prefab,
        options: undefined,
      });
    }
  });

  it('the incinerator is never offered (D5)', () => {
    const smelter = must(DEMO.processors[0], 'processor');
    const process = must(DEMO.processes[0], 'process');
    const g = buildRecipeGraph({
      ...DEMO,
      processors: [
        ...DEMO.processors,
        { ...smelter, prefab: 'incinerator', type: 'incinerator' },
      ],
      processes: [...DEMO.processes, { ...process, processor: 'incinerator' }],
    });
    const refs = (sourceOptionsOf(g, 'Coal') ?? []).map((o) => o.ref);
    expect(refs).not.toContainEqual(
      expect.objectContaining({ processor: 'incinerator' }),
    );
    expect(refs).toHaveLength(2);
  });

  it('a recipe at a hidden station (ROK-1948 R6) is never offered', () => {
    const forgeless = buildRecipeGraph({
      ...DEMO,
      recipes: [
        recipeOf('Recipe_Bronze'),
        { ...recipeOf('Recipe_Club'), result: 'Bronze', id: 'Recipe_ZBench' },
      ],
      stations: DEMO.stations.filter((s) => s.prefab !== 'forge'),
    });
    const pruned: RecipeGraph = { ...forgeless, withheld: new Set<string>() };
    expect(sourceOptionsOf(forgeless, 'Bronze')).toHaveLength(2);
    expect(sourceOptionsOf(pruned, 'Bronze')).toBeUndefined();
  });
});

describe('catalogueEntries sourceOptions', () => {
  it('only multi-source items carry it; pieces never do', () => {
    const withOptions = catalogueEntries(demo, null)
      .filter((e) => e.sourceOptions !== undefined)
      .map((e) => `${e.kind}:${e.prefab}:${e.sourceOptions?.length}`);
    expect(withOptions).toEqual(['item:Bronze:2', 'item:Coal:2']);
  });
});
