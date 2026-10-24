import type {
  ValheimPiece,
  ValheimPlanNode,
  ValheimProcess,
  ValheimRecipe,
  ValheimRecipeCatalogEntry,
  ValheimRecipeStation,
} from '@raid-ledger/contract';
import { RECIPES_DEMO_MESSAGE } from '../valheim-armory-recipes-demo-fixture';
import { ARMORY_KNOWN_LIST_MAX } from '../valheim-armory.mappers';
import {
  catalogueEntries,
  catalogueStations,
} from './valheim-recipes.catalog.helpers';
import { buildRecipeGraph, type RecipeGraph } from './valheim-recipes.graph';
import {
  buildVisibleGraph,
  clampStationLevels,
  serverKnown,
  spoilerGraph,
  undiscoveredLeaf,
  type ProfileKnownLists,
} from './valheim-recipes.spoilers';

const DEMO = RECIPES_DEMO_MESSAGE;

const res = (prefab: string, amount = 1) => ({
  prefab,
  amount,
  amountPerLevel: 0,
  extraAmountOnlyOneIngredient: 0,
  recover: true,
});

function recipe(
  id: string,
  result: string,
  station: string | null,
  resources: string[] = [],
): ValheimRecipe {
  return {
    id,
    result,
    amount: 1,
    enabled: true,
    station,
    repairStation: station,
    minStationLevel: 1,
    upgradeOnly: false,
    anyOneOf: false,
    qualityResultAmountMultiplier: 1,
    formula: 'vanilla',
    resources: resources.map((p) => res(p)),
  };
}

function piece(prefab: string, station: string | null): ValheimPiece {
  return {
    prefab,
    name: prefab,
    category: 'Crafting',
    tool: 'Hammer',
    station,
    icon: null,
    resources: [{ prefab: 'Wood', amount: 2, recover: true }],
  };
}

function smelt(
  processor: string,
  input: string,
  output: string,
): ValheimProcess {
  return {
    processor,
    inputs: [{ prefab: input, amount: 1 }],
    anyOneOf: false,
    output: { prefab: output, amount: 1 },
    seconds: 30,
    priority: 0,
  };
}

interface Extra {
  recipes?: ValheimRecipe[];
  pieces?: ValheimPiece[];
  processes?: ValheimProcess[];
}

/** The demo set (Workbench, Forge, Club, SwordIron, Bronze chain, 3 processors) + extras. */
function demoGraph(extra: Extra = {}): RecipeGraph {
  return buildRecipeGraph({
    recipes: [...DEMO.recipes, ...(extra.recipes ?? [])],
    pieces: [...DEMO.pieces, ...(extra.pieces ?? [])],
    stations: DEMO.stations,
    processors: DEMO.processors,
    processes: [...(extra.processes ?? []), ...DEMO.processes],
    gameVersion: DEMO.gameVersion,
  });
}

const known = (recipes: string[], items: string[] = []) => ({
  recipes: new Set(recipes),
  items: new Set(items),
});

const keys = (m: ReadonlyMap<string, unknown>) => [...m.keys()].sort();

const profile = (
  knownRecipes: string[],
  knownItems: string[] = [],
): ProfileKnownLists => ({ knownRecipes, knownItems });

const capped = () =>
  Array.from({ length: ARMORY_KNOWN_LIST_MAX }, (_, i) => `P${i}`);

describe('serverKnown (D3/D4)', () => {
  it('no profile on the server → off-no-data', () => {
    expect(serverKnown([]).status).toBe('off-no-data');
  });

  it('every list empty → off-no-data (unlike ROK-1862, [] is unusable)', () => {
    const k = serverKnown([profile([]), profile([], [])]);
    expect(k.status).toBe('off-no-data');
    expect(k.recipes.size).toBe(0);
  });

  it('token-only (pre-0.4.2) lists → off-no-data', () => {
    const k = serverKnown([profile(['_item_club', '_piece_workbench'])]);
    expect(k.status).toBe('off-no-data');
  });

  it('a usable known_items list alone does not turn protection on', () => {
    expect(serverKnown([profile([], ['CopperOre'])]).status).toBe(
      'off-no-data',
    );
  });

  it('unions every profile, drops legacy tokens, ignores empty lists', () => {
    const k = serverKnown([
      profile(['_item_club', 'Club'], ['_item_wood']),
      profile([]),
      profile(['piece_workbench'], ['CopperOre']),
    ]);
    expect(k.status).toBe('protected');
    expect([...k.recipes].sort()).toEqual(['Club', 'piece_workbench']);
    expect([...k.items]).toEqual(['CopperOre']);
  });

  it(`a known_recipes list at the cap (${ARMORY_KNOWN_LIST_MAX}) → off-truncated, even beside usable lists`, () => {
    const k = serverKnown([profile(['Club']), profile(capped())]);
    expect(k.status).toBe('off-truncated');
    expect(k.recipes.size).toBe(0);
  });

  it('a known_items list at the cap → off-truncated', () => {
    expect(serverKnown([profile(['Club'], capped())]).status).toBe(
      'off-truncated',
    );
  });

  it('one below the cap is still protected', () => {
    const list = capped().slice(1);
    expect(serverKnown([profile(list)]).status).toBe('protected');
  });

  it('does not depend on profile order', () => {
    const a = profile(['Club'], ['Wood']);
    const b = profile(['forge'], ['CopperOre']);
    const ab = serverKnown([a, b]);
    const ba = serverKnown([b, a]);
    expect([...ab.recipes].sort()).toEqual([...ba.recipes].sort());
    expect([...ab.items].sort()).toEqual([...ba.items].sort());
  });
});

describe('buildVisibleGraph — AC1 (Workbench + Club only)', () => {
  const full = demoGraph({ pieces: [piece('forge_bellows', 'forge')] });
  const visible = buildVisibleGraph(full, known(['piece_workbench', 'Club']));

  it('keeps Workbench + Club; Forge, Bronze, Bronze sword, SwordIron and forge upgrades are gone', () => {
    expect(keys(visible.stations)).toEqual(['piece_workbench']);
    expect(keys(visible.recipesByResult)).toEqual(['Club']);
    expect(keys(visible.pieces)).toEqual([]);
    expect(keys(visible.processesByOutput)).toEqual([]);
    expect(keys(visible.processors)).toEqual([]);
  });

  it('withheld = every prefab with a source in the full graph but none here', () => {
    expect([...visible.withheld]).toEqual([
      'Bronze',
      'Coal',
      'CookedMeat',
      'Copper',
      'Iron',
      'SwordBronze',
      'SwordIron',
      'Tin',
      'forge_bellows',
      'piece_chest',
    ]);
  });

  it('no projection of the visible graph names a hidden thing', () => {
    const body = JSON.stringify({
      entries: catalogueEntries(visible, null),
      stations: catalogueStations(visible),
    });
    for (const hidden of ['orge', 'Bronze', 'SwordIron', 'smelter', 'Coal']) {
      expect(body).not.toContain(hidden);
    }
    expect(catalogueEntries(visible, null).map((e) => e.prefab)).toEqual([
      'Club',
    ]);
  });

  it('never mutates the full graph', () => {
    const before = keys(full.recipesByResult);
    buildVisibleGraph(full, known(['Club']));
    expect(keys(full.recipesByResult)).toEqual(before);
    expect(keys(full.stations)).toEqual(['forge', 'piece_workbench']);
    expect(full.withheld).toBeUndefined();
  });

  it('is deterministic: the same inputs give deep-equal graphs', () => {
    const again = buildVisibleGraph(full, known(['Club', 'piece_workbench']));
    expect(again).toEqual(visible);
  });
});

describe('buildVisibleGraph — stations and pieces (R1/R2)', () => {
  const full = demoGraph({
    pieces: [piece('forge_bellows', 'forge'), piece('ghost_bench', 'nowhere')],
  });

  it('a station shows behind a known recipe even without its own entry (A2)', () => {
    const v = buildVisibleGraph(full, known(['Club']));
    expect(keys(v.stations)).toEqual(['piece_workbench']);
    expect(keys(v.recipesByResult)).toEqual(['Club']);
  });

  it('a station shows behind a known piece built there', () => {
    const v = buildVisibleGraph(full, known(['piece_chest']));
    expect(keys(v.stations)).toEqual(['piece_workbench']);
    expect(keys(v.pieces)).toEqual(['piece_chest']);
  });

  it('a known station alone shows the station, not its unknown recipes or extensions', () => {
    const v = buildVisibleGraph(full, known(['forge']));
    expect(keys(v.stations)).toEqual(['forge']);
    expect(keys(v.recipesByResult)).toEqual([]);
    expect(keys(v.pieces)).toEqual([]);
  });

  it('a known extension piece shows with its station', () => {
    const v = buildVisibleGraph(full, known(['forge_bellows']));
    expect(keys(v.pieces)).toEqual(['forge_bellows']);
    expect(keys(v.stations)).toEqual(['forge']);
  });

  it('a known piece whose station is not in the set stays hidden', () => {
    const v = buildVisibleGraph(full, known(['ghost_bench']));
    expect(keys(v.pieces)).toEqual([]);
    expect(v.withheld.has('ghost_bench')).toBe(true);
  });

  it('a known recipe whose station is not in the set stays hidden', () => {
    const g = demoGraph({
      recipes: [recipe('Recipe_Ghost', 'Ghost', 'nowhere')],
    });
    const v = buildVisibleGraph(g, known(['Recipe_Ghost']));
    expect(keys(v.recipesByResult)).toEqual([]);
    expect(v.withheld.has('Ghost')).toBe(true);
  });
});

describe('buildVisibleGraph — recipes (R3)', () => {
  it('the Recipe_* id form and the result-prefab form both match', () => {
    const byId = buildVisibleGraph(demoGraph(), known(['Recipe_Bronze']));
    const byResult = buildVisibleGraph(demoGraph(), known(['SwordBronze']));
    expect(keys(byId.recipesByResult)).toEqual(['Bronze']);
    expect(keys(byId.stations)).toEqual(['forge']);
    expect(keys(byResult.recipesByResult)).toEqual(['SwordBronze']);
  });

  it('an unknown second recipe for a known item is dropped and not counted', () => {
    const full = demoGraph({
      recipes: [recipe('Recipe_ClubForge', 'Club', 'forge', ['Iron'])],
    });
    const v = buildVisibleGraph(full, known(['Recipe_Club']));
    expect(v.recipesByResult.get('Club')?.map((r) => r.id)).toEqual([
      'Recipe_Club',
    ]);
    const club = catalogueEntries(v, null).find((e) => e.prefab === 'Club');
    expect(club?.sources).toEqual({ recipes: 1, processes: 0 });
    expect(keys(v.stations)).toEqual(['piece_workbench']);
  });

  it('a stationless recipe needs only knowledge', () => {
    const full = demoGraph({
      recipes: [recipe('Recipe_Torch', 'Torch', null)],
    });
    const v = buildVisibleGraph(full, known(['Torch']));
    expect(keys(v.recipesByResult)).toEqual(['Torch']);
    expect(keys(v.stations)).toEqual([]);
  });

  it('R7: a known recipe still names a hidden ingredient, whose own source stays withheld', () => {
    const full = demoGraph({
      recipes: [
        recipe('Recipe_ClubBronze', 'ClubBronze', 'piece_workbench', [
          'Bronze',
        ]),
      ],
    });
    const v = buildVisibleGraph(full, known(['Recipe_ClubBronze']));
    expect(keys(v.recipesByResult)).toEqual(['ClubBronze']);
    expect(v.recipesByResult.has('Bronze')).toBe(false);
    expect(v.withheld.has('Bronze')).toBe(true);
    const entry = catalogueEntries(v, null)[0];
    expect(entry?.craft?.resources.map((r) => r.prefab)).toEqual(['Bronze']);
  });
});

describe('buildVisibleGraph — process-only items (R4)', () => {
  it('a known Smelter with no ore known or used reveals no bar', () => {
    const v = buildVisibleGraph(
      demoGraph(),
      known(['smelter', 'Club', 'piece_workbench']),
    );
    expect(keys(v.processors)).toEqual(['smelter']);
    expect(keys(v.processesByOutput)).toEqual([]);
    for (const bar of ['Iron', 'Copper', 'Tin']) {
      expect(v.withheld.has(bar)).toBe(true);
    }
  });

  it('a known ore (I) reveals its bar only: CopperOre → Copper, Iron and Tin stay hidden', () => {
    const v = buildVisibleGraph(demoGraph(), known(['smelter'], ['CopperOre']));
    expect(keys(v.processesByOutput)).toEqual(['Copper']);
  });

  it('an unknown processor hides its process even when the ore is known', () => {
    const v = buildVisibleGraph(demoGraph(), known(['Club'], ['CopperOre']));
    expect(keys(v.processors)).toEqual([]);
    expect(keys(v.processesByOutput)).toEqual([]);
  });

  it('an output a kept recipe uses is materially visible (Bronze needs Copper + Tin)', () => {
    const v = buildVisibleGraph(
      demoGraph(),
      known(['Recipe_Bronze', 'smelter']),
    );
    expect(keys(v.processesByOutput)).toEqual(['Copper', 'Tin']);
  });

  it('an input a kept recipe uses is materially visible (Club uses Wood → kiln Coal)', () => {
    const v = buildVisibleGraph(demoGraph(), known(['Club', 'charcoal_kiln']));
    expect(keys(v.processesByOutput)).toEqual(['Coal']);
  });

  it('iterates to a fixed point: a kept output reveals the process that consumes it', () => {
    // Listed first, so a single pass would test it before Bar is known.
    const full = demoGraph({
      processes: [
        smelt('smelter', 'Bar', 'Ingot'),
        smelt('smelter', 'Ore', 'Bar'),
      ],
    });
    const v = buildVisibleGraph(full, known(['smelter'], ['Ore']));
    expect(keys(v.processesByOutput)).toEqual(['Bar', 'Ingot']);
  });
});

describe('spoilerGraph (fallback)', () => {
  const full = demoGraph();

  it.each(['off-no-data', 'off-truncated'] as const)(
    '%s → the full graph, untouched',
    (status) => {
      const g = spoilerGraph(full, { status, ...known([]) });
      expect(g).toBe(full);
    },
  );

  it('protected → the pruned graph', () => {
    const g = spoilerGraph(full, { status: 'protected', ...known(['Club']) });
    expect(g).not.toBe(full);
    expect(keys(g.recipesByResult)).toEqual(['Club']);
    expect(g.withheld?.has('SwordBronze')).toBe(true);
  });
});

describe('clampStationLevels (Q4)', () => {
  const station = (prefab: string, maxLevel: number): ValheimRecipeStation => ({
    prefab,
    name: prefab,
    maxLevel,
    upgrader: false,
    icon: null,
  });
  const cost = (s: string, level: number) => ({
    station: s,
    stationLevel: level,
    anyOneOf: false,
    resources: [],
  });
  const entry = (
    craftLevel: number,
    upgradeLevels: number[],
  ): ValheimRecipeCatalogEntry => ({
    prefab: 'Club',
    kind: 'item',
    name: 'Club',
    category: '',
    icon: null,
    maxQuality: 1 + upgradeLevels.length,
    sources: { recipes: 1, processes: 0 },
    craft: { ...cost('piece_workbench', craftLevel), via: 'recipe', amount: 1 },
    upgrades: upgradeLevels.map((l, i) => ({
      ...cost('piece_workbench', l),
      quality: i + 2,
      upgraderStation: false,
    })),
  });

  it('clamps to the highest level a shown craft/upgrade needs', () => {
    const out = clampStationLevels(
      [station('piece_workbench', 5)],
      [entry(1, [2, 3])],
    );
    expect(out[0]?.maxLevel).toBe(3);
  });

  it('a station nothing shown needs reads 1', () => {
    expect(clampStationLevels([station('forge', 7)], [])[0]?.maxLevel).toBe(1);
  });

  it('never exceeds the real maxLevel', () => {
    const out = clampStationLevels(
      [station('piece_workbench', 2)],
      [entry(1, [4])],
    );
    expect(out[0]?.maxLevel).toBe(2);
  });
});

describe('undiscoveredLeaf (D7)', () => {
  const hiddenSource: ValheimPlanNode = {
    id: 4,
    parentId: 1,
    prefab: 'Bronze',
    quantity: 8,
    via: {
      type: 'recipe',
      recipeId: 'Recipe_Bronze',
      station: 'forge',
      stationLevel: 2,
      quality: 1,
      upgradeOnly: false,
      formula: 'vanilla',
      anyOneOf: false,
      upgraderStation: false,
    },
    alternatives: 3,
    crafts: 8,
    have: 2,
    short: 6,
    discovered: false,
  };

  it('keeps only the node itself and the amount the known recipe asks for', () => {
    expect(undiscoveredLeaf(hiddenSource)).toEqual({
      id: 4,
      parentId: 1,
      prefab: 'Bronze',
      quantity: 8,
      via: { type: 'undiscovered' },
      alternatives: 0,
      crafts: 0,
      have: 2,
      short: 6,
    });
  });

  it('carries no name or count of what is missing', () => {
    const body = JSON.stringify(undiscoveredLeaf(hiddenSource));
    for (const leak of [
      'forge',
      'Recipe_',
      'station',
      '"discovered"',
      '"alternatives":3',
    ]) {
      expect(body).not.toContain(leak);
    }
  });
});
