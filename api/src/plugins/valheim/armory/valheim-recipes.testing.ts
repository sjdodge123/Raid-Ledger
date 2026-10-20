/**
 * ROK-1854 — test-only `recipes` message builders shared by the import and
 * read integration specs: a Bronze world (the resolver spec's chain, as a
 * wire message) and the largest schema-valid message (copied from the
 * contract's `valheim-link-largest-message.spec.ts`, which exports nothing).
 */
import {
  VALHEIM_LINK_BINARY_MAX_BYTES,
  VALHEIM_LINK_PIECES_MAX,
  VALHEIM_LINK_PROCESSES_MAX,
  VALHEIM_LINK_PROCESSORS_MAX,
  VALHEIM_LINK_RECIPE_ENTRIES_MAX,
  VALHEIM_LINK_RECIPES_MAX,
  VALHEIM_LINK_REQUIREMENTS_MAX,
  VALHEIM_LINK_STATION_LEVEL_MAX,
  VALHEIM_LINK_STATIONS_MAX,
} from '@raid-ledger/contract';
import { loadValheimFixture } from '../link/ingest/valheim-link-ingest.testing';

type Msg = Record<string, unknown>;

export const recipeRes = (prefab: string, amount: number, perLevel = 0) => ({
  prefab,
  amount,
  amountPerLevel: perLevel,
  extraAmountOnlyOneIngredient: 0,
  recover: true,
});

export function recipeEntry(
  id: string,
  result: string,
  resources: Array<ReturnType<typeof recipeRes>>,
  over: Msg = {},
): Msg {
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

function processorEntry(
  prefab: string,
  fuel: string | null = null,
  fuelPerProduct: number | null = null,
): Msg {
  return {
    prefab,
    type: 'smelter',
    fuel,
    fuelPerProduct,
    fuelSecondsPerUnit: null,
    windPowered: false,
    requiresRoof: false,
    maxInput: 10,
    burntResult: null,
    defaultResult: null,
  };
}

const processEntry = (processor: string, input: string, output: string) => ({
  processor,
  inputs: [{ prefab: input, amount: 1 }],
  anyOneOf: false,
  output: { prefab: output, amount: 1 },
  seconds: 30,
  priority: 0,
});

const station = (prefab: string, name: string, maxLevel: number) => ({
  prefab,
  name,
  maxLevel,
  stackableExtension: false,
  icon: null,
});

/**
 * The vanilla fixture's header with the resolver spec's Bronze chain:
 * Bronze ← Copper 2 + Tin 1 (forge); Copper/Tin ← ore (smelter, 2 Coal per
 * product); Coal ← Wood (charcoal kiln); SwordBronze ← Bronze 8 (+4/level),
 * Wood 2 (+1), LeatherScraps 2 (+1); piece_chest ← Wood 10.
 */
export function bronzeRecipes(over: Msg = {}): Msg {
  const vanilla = loadValheimFixture('recipes-vanilla');
  return {
    ...vanilla,
    stations: [
      station('piece_workbench', 'Workbench', 5),
      station('forge', 'Forge', 7),
    ],
    recipes: [
      recipeEntry('Recipe_Bronze', 'Bronze', [
        recipeRes('Copper', 2),
        recipeRes('Tin', 1),
      ]),
      recipeEntry('Recipe_SwordBronze', 'SwordBronze', [
        recipeRes('Bronze', 8, 4),
        recipeRes('Wood', 2, 1),
        recipeRes('LeatherScraps', 2, 1),
      ]),
    ],
    processors: [
      processorEntry('smelter', 'Coal', 2),
      processorEntry('charcoal_kiln'),
    ],
    processes: [
      processEntry('smelter', 'CopperOre', 'Copper'),
      processEntry('smelter', 'TinOre', 'Tin'),
      processEntry('charcoal_kiln', 'Wood', 'Coal'),
    ],
    ...over,
  };
}

// ---- largest schema-valid `recipes` message (contract spec copy) ----------

const ctl = (n: number): string => '\u0001'.repeat(n);
const prefab = (i: number): string => `p${i}`.padEnd(96, 'x');
const atlasIcon = { kind: 'atlas', x: 15_872, y: 15_872, w: 512, h: 512 };
const recipeResource = (j: number) => ({
  prefab: prefab(j),
  amount: 10_000,
  amountPerLevel: 10_000,
  extraAmountOnlyOneIngredient: 10_000,
  recover: false,
  upgraderResource: false,
});

function recipeAt(i: number, resourceCount: number): Msg {
  return {
    id: `r${i}`.padEnd(96, 'x'),
    result: prefab(i),
    amount: 10_000,
    enabled: false,
    station: prefab(0),
    repairStation: prefab(0),
    minStationLevel: VALHEIM_LINK_STATION_LEVEL_MAX,
    upgradeOnly: false,
    anyOneOf: false,
    qualityResultAmountMultiplier: 99.99999999999997,
    formula: 'vanilla',
    resources: Array.from({ length: resourceCount }, (_, j) =>
      recipeResource(j),
    ),
  };
}

const pieceAt = (i: number): Msg => ({
  prefab: prefab(i),
  name: ctl(96),
  category: 'C'.repeat(48),
  tool: prefab(0),
  station: prefab(0),
  icon: atlasIcon,
  resources: [],
});

const largestProcessor = (i: number): Msg => ({
  prefab: prefab(i),
  type: 'incinerator',
  fuel: prefab(0),
  fuelPerProduct: 1_000,
  fuelSecondsPerUnit: 86399.99999999999,
  windPowered: false,
  requiresRoof: false,
  maxInput: 10_000,
  burntResult: prefab(0),
  defaultResult: { prefab: prefab(0), perInputs: 10_000 },
});

const largestProcess = (i: number): Msg => ({
  processor: prefab(i % VALHEIM_LINK_PROCESSORS_MAX),
  inputs: [{ prefab: prefab(0), amount: 10_000 }],
  anyOneOf: false,
  output: { prefab: prefab(0), amount: 10_000 },
  seconds: 604799.9999999999,
  priority: -10_000,
});

/** Every array full, every string at its cap; `serverId` re-pointed. */
export function largestRecipesMessage(serverId: string, capturedAt: string) {
  const budget = VALHEIM_LINK_RECIPE_ENTRIES_MAX - VALHEIM_LINK_PROCESSES_MAX;
  const full = Math.floor(budget / VALHEIM_LINK_REQUIREMENTS_MAX);
  const rest = budget % VALHEIM_LINK_REQUIREMENTS_MAX;
  const size = (i: number) =>
    i < full ? VALHEIM_LINK_REQUIREMENTS_MAX : i === full ? rest : 0;
  return {
    schemaVersion: 1,
    serverId,
    capturedAt,
    gameVersion: '9999.99999.99999.99999',
    modVersion: `99999.99999.99999-${'a'.repeat(46)}`,
    kind: 'recipes',
    locale: 'L'.repeat(32),
    atlas: {
      sha256: 'f'.repeat(64),
      byteLength: VALHEIM_LINK_BINARY_MAX_BYTES,
      contentType: 'image/png',
      width: 16_384,
      height: 16_384,
    },
    stations: Array.from({ length: VALHEIM_LINK_STATIONS_MAX }, (_, i) => ({
      prefab: prefab(i),
      name: ctl(96),
      maxLevel: VALHEIM_LINK_STATION_LEVEL_MAX,
      stackableExtension: false,
      upgrader: false,
      icon: atlasIcon,
    })),
    recipes: Array.from({ length: VALHEIM_LINK_RECIPES_MAX }, (_, i) =>
      recipeAt(i, size(i)),
    ),
    pieces: Array.from({ length: VALHEIM_LINK_PIECES_MAX }, (_, i) =>
      pieceAt(i),
    ),
    processors: Array.from({ length: VALHEIM_LINK_PROCESSORS_MAX }, (_, i) =>
      largestProcessor(i),
    ),
    processes: Array.from({ length: VALHEIM_LINK_PROCESSES_MAX }, (_, i) =>
      largestProcess(i),
    ),
  };
}
