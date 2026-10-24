import type {
  ValheimPlanNode,
  ValheimPiece,
  ValheimPlanVia,
  ValheimProcess,
  ValheimRecipe,
  ValheimRecipeCatalogEntry,
} from '@raid-ledger/contract';
import { ARMORY_KNOWN_LIST_MAX } from '../valheim-armory.mappers';
import { buildRecipeGraph } from './valheim-recipes.graph';
import {
  entryDiscovered,
  nodeDiscovered,
  toKnownSet,
  withEntryDiscovery,
  withNodeDiscovery,
} from './valheim-recipes.discovery';

function recipe(
  id: string,
  result: string,
  upgradeOnly = false,
): ValheimRecipe {
  return {
    id,
    result,
    amount: 1,
    enabled: true,
    station: null,
    repairStation: null,
    minStationLevel: 1,
    upgradeOnly,
    anyOneOf: false,
    qualityResultAmountMultiplier: 1,
    formula: 'vanilla',
    resources: [],
  };
}

function piece(prefab: string): ValheimPiece {
  return {
    prefab,
    name: prefab,
    category: 'Furniture',
    tool: 'Hammer',
    station: null,
    icon: null,
    resources: [],
  };
}

const smeltBronze: ValheimProcess = {
  processor: 'smelter',
  inputs: [{ prefab: 'CopperOre', amount: 1 }],
  anyOneOf: false,
  output: { prefab: 'Bronze', amount: 1 },
  seconds: 30,
  priority: 0,
};

const graph = buildRecipeGraph({
  recipes: [
    recipe('Recipe_SwordBronze', 'SwordBronze'),
    recipe('Recipe_Club', 'Club'),
    recipe('Recipe_CapeUpgrade', 'CapeTroll', true),
  ],
  pieces: [],
  stations: [],
  processors: [],
  processes: [smeltBronze],
});

function entry(
  prefab: string,
  kind: 'item' | 'piece' = 'item',
): ValheimRecipeCatalogEntry {
  return {
    prefab,
    kind,
    name: prefab,
    category: 'Misc',
    icon: null,
    maxQuality: 1,
    sources: { recipes: 0, processes: 0 },
    craft: null,
    upgrades: [],
  };
}

function recipeVia(recipeId: string): ValheimPlanVia {
  return {
    type: 'recipe',
    recipeId,
    station: null,
    stationLevel: 0,
    quality: 1,
    upgradeOnly: false,
    formula: 'vanilla',
    anyOneOf: false,
    upgraderStation: false,
  };
}

function node(prefab: string, via: ValheimPlanVia): ValheimPlanNode {
  return {
    id: 0,
    parentId: null,
    prefab,
    quantity: 1,
    via,
    alternatives: 0,
    crafts: 1,
    have: null,
    short: null,
  };
}

const set = (...ids: string[]) => new Set(ids);

describe('toKnownSet (D3, Q1)', () => {
  it('no claimed character → no-character, no list', () => {
    expect(toKnownSet([])).toEqual({ status: 'no-character', known: null });
  });

  it('unions every claimed character on the server', () => {
    const k = toKnownSet([['SwordBronze'], ['Club']]);
    expect(k.status).toBe('known');
    expect([...(k.known ?? [])].sort()).toEqual(['Club', 'SwordBronze']);
  });

  it('a list at exactly the store cap is truncated → unknown', () => {
    const full = Array.from(
      { length: ARMORY_KNOWN_LIST_MAX },
      (_, i) => `P${i}`,
    );
    expect(toKnownSet([['Club'], full])).toEqual({
      status: 'truncated',
      known: null,
    });
  });

  it('a token-only (pre-0.4.2) list → outdated, no list', () => {
    expect(toKnownSet([['_item_sword_bronze', '_piece_workbench']])).toEqual({
      status: 'outdated',
      known: null,
    });
  });

  it('a mixed list keeps only its prefab entries', () => {
    const k = toKnownSet([['_item_club', 'SwordBronze', '_piece_forge']]);
    expect(k.status).toBe('known');
    expect([...(k.known ?? [])]).toEqual(['SwordBronze']);
  });

  it('other legacy token families (ships, cart) also count as tokens → outdated', () => {
    expect(toKnownSet([['_item_club', '_ship_raft', '_tool_cart']])).toEqual({
      status: 'outdated',
      known: null,
    });
  });

  it('an empty known list is a new character → known, nothing discovered', () => {
    const k = toKnownSet([[]]);
    expect(k.status).toBe('known');
    expect(k.known?.size).toBe(0);
  });

  it('one outdated + one current character → known from the current list', () => {
    const k = toKnownSet([['_item_club'], ['Recipe_Club']]);
    expect(k.status).toBe('known');
    expect([...(k.known ?? [])]).toEqual(['Recipe_Club']);
  });

  it('one under the cap is still trusted', () => {
    const list = Array.from({ length: ARMORY_KNOWN_LIST_MAX - 1 }, () => 'X');
    expect(toKnownSet([list]).status).toBe('known');
  });
});

describe('entryDiscovered (D2)', () => {
  it('matches the result prefab form', () => {
    expect(
      entryDiscovered(graph, entry('SwordBronze'), set('SwordBronze')),
    ).toBe(true);
  });

  it('matches the Recipe_* id form', () => {
    expect(
      entryDiscovered(graph, entry('SwordBronze'), set('Recipe_SwordBronze')),
    ).toBe(true);
  });

  it('a recipe item the list lacks is not discovered', () => {
    expect(entryDiscovered(graph, entry('SwordBronze'), set('Club'))).toBe(
      false,
    );
  });

  it('pieces match their own prefab', () => {
    const piece = entry('piece_workbench', 'piece');
    expect(entryDiscovered(graph, piece, set('piece_workbench'))).toBe(true);
    expect(entryDiscovered(graph, piece, set('piece_chest'))).toBe(false);
  });

  it('process-only items (bars) are not gated → null', () => {
    expect(entryDiscovered(graph, entry('Bronze'), set('Club'))).toBeNull();
  });

  it('gathered items are not gated → null', () => {
    expect(entryDiscovered(graph, entry('Wood'), set('Club'))).toBeNull();
  });

  it('upgrade-only items follow the recipe rule', () => {
    expect(
      entryDiscovered(graph, entry('CapeTroll'), set('Recipe_CapeUpgrade')),
    ).toBe(true);
    expect(entryDiscovered(graph, entry('CapeTroll'), set('Club'))).toBe(false);
  });

  it('no usable list → null for every entry', () => {
    expect(entryDiscovered(graph, entry('SwordBronze'), null)).toBeNull();
  });
});

describe('nodeDiscovered (D2)', () => {
  it('recipe nodes match prefab or recipe id', () => {
    const n = node('SwordBronze', recipeVia('Recipe_SwordBronze'));
    expect(nodeDiscovered(graph, n, set('SwordBronze'))).toBe(true);
    expect(nodeDiscovered(graph, n, set('Recipe_SwordBronze'))).toBe(true);
    expect(nodeDiscovered(graph, n, set('Club'))).toBe(false);
  });

  it('gathered, fuel and cycle nodes → null', () => {
    const known = set('Wood', 'Resin', 'Bronze');
    expect(
      nodeDiscovered(graph, node('Wood', { type: 'gathered' }), known),
    ).toBeNull();
    expect(
      nodeDiscovered(graph, node('Resin', { type: 'fuel' }), known),
    ).toBeNull();
    expect(
      nodeDiscovered(graph, node('Bronze', { type: 'cycle' }), known),
    ).toBeNull();
  });

  it('process nodes → null', () => {
    const via: ValheimPlanVia = {
      type: 'process',
      processor: 'smelter',
      processorType: 'smelter',
      seconds: 30,
      windPowered: false,
      fuel: 'Coal',
    };
    expect(
      nodeDiscovered(graph, node('Bronze', via), set('Bronze')),
    ).toBeNull();
  });
});

describe('a prefab that is both a build piece and a crafted item', () => {
  const both = buildRecipeGraph({
    recipes: [recipe('Recipe_Bed', 'Bed')],
    pieces: [piece('Bed')],
    stations: [],
    processors: [],
    processes: [],
  });
  const pieceNode = node('Bed', recipeVia('Bed'));

  it('the piece node and the piece entry both need the piece prefab', () => {
    const known = set('Recipe_Bed');
    expect(entryDiscovered(both, entry('Bed', 'piece'), known)).toBe(false);
    expect(nodeDiscovered(both, pieceNode, known)).toBe(false);
  });

  it('the item node and the item entry both accept the recipe id', () => {
    const known = set('Recipe_Bed');
    const itemNode = node('Bed', recipeVia('Recipe_Bed'));
    expect(entryDiscovered(both, entry('Bed'), known)).toBe(true);
    expect(nodeDiscovered(both, itemNode, known)).toBe(true);
  });

  it('knowing the piece prefab discovers both', () => {
    expect(entryDiscovered(both, entry('Bed', 'piece'), set('Bed'))).toBe(true);
    expect(nodeDiscovered(both, pieceNode, set('Bed'))).toBe(true);
  });
});

describe('an item whose only recipes are disabled, beside a process', () => {
  const smeltIron: ValheimProcess = {
    ...smeltBronze,
    inputs: [{ prefab: 'IronScrap', amount: 1 }],
    output: { prefab: 'Iron', amount: 1 },
  };
  const disabled = buildRecipeGraph({
    recipes: [{ ...recipe('Recipe_Iron', 'Iron'), enabled: false }],
    pieces: [],
    stations: [],
    processors: [],
    processes: [smeltIron],
  });
  const processNode = node('Iron', {
    type: 'process',
    processor: 'smelter',
    processorType: 'smelter',
    seconds: 30,
    windPowered: false,
    fuel: 'Coal',
  });

  it('is not recipe-gated: entry and node are both null', () => {
    const known = set('Club');
    expect(entryDiscovered(disabled, entry('Iron'), known)).toBeNull();
    expect(nodeDiscovered(disabled, processNode, known)).toBeNull();
  });

  it('knowing the disabled recipe id changes nothing', () => {
    const known = set('Recipe_Iron');
    expect(entryDiscovered(disabled, entry('Iron'), known)).toBeNull();
    expect(nodeDiscovered(disabled, processNode, known)).toBeNull();
  });
});

describe('withEntryDiscovery / withNodeDiscovery', () => {
  it('stamps every entry, leaving the rest of the row intact', () => {
    const k = toKnownSet([['Recipe_Club']]);
    const out = withEntryDiscovery(
      [entry('Club'), entry('SwordBronze'), entry('Wood')],
      graph,
      k,
    );
    expect(out.map((e) => [e.prefab, e.discovered])).toEqual([
      ['Club', true],
      ['SwordBronze', false],
      ['Wood', null],
    ]);
    expect(out[0]).toEqual({ ...entry('Club'), discovered: true });
  });

  it('truncated lists stamp null everywhere', () => {
    const full = Array.from({ length: ARMORY_KNOWN_LIST_MAX }, () => 'Club');
    const k = toKnownSet([full]);
    const entries = withEntryDiscovery([entry('Club')], graph, k);
    const nodes = withNodeDiscovery(
      [node('Club', recipeVia('Recipe_Club'))],
      graph,
      k,
    );
    expect(entries.map((e) => e.discovered)).toEqual([null]);
    expect(nodes.map((n) => n.discovered)).toEqual([null]);
  });

  it('stamps plan nodes', () => {
    const k = toKnownSet([['SwordBronze']]);
    const out = withNodeDiscovery(
      [
        node('SwordBronze', recipeVia('Recipe_SwordBronze')),
        node('Club', recipeVia('Recipe_Club')),
      ],
      graph,
      k,
    );
    expect(out.map((n) => n.discovered)).toEqual([true, false]);
  });
});
