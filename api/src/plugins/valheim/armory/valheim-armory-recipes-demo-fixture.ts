/**
 * ROK-1854 L5 — the DEMO_MODE recipes fixture: the golden
 * `packages/contract/valheim-link/v1/fixtures/recipes-vanilla.json` (inlined —
 * the runtime image does not ship the contract fixtures; the seed's
 * integration spec pins this copy to the golden file) EXTENDED with a Bronze
 * chain the golden file lacks:
 *
 *   SwordBronze (forge) ← Bronze 8 (+4/level) + Wood 2 + LeatherScraps 3
 *   Bronze (forge)      ← Copper 2 + Tin 1
 *   Copper / Tin        ← smelter: CopperOre / TinOre, fuel Coal ×2 per bar
 *   Coal                ← charcoal_kiln (a fuel-less `smelter`): Wood
 *
 * Plus the catalogue names those prefabs need, and one public chest holding
 * 40 Copper (and no Tin) so a plan shows Copper covered and Tin short.
 */
import type {
  ValheimContainer,
  ValheimContainersMessage,
  ValheimProcess,
  ValheimProcessor,
  ValheimRecipe,
  ValheimRecipesMessage,
} from '@raid-ledger/contract';
import type { ValheimItemCatalogEntryRow } from '../../../drizzle/schema';
import { CONTAINERS_DEMO_MESSAGE } from './valheim-armory-containers-demo-fixture';

type Resource = ValheimRecipe['resources'][number];

const res = (prefab: string, amount: number, amountPerLevel = 0): Resource => ({
  prefab,
  amount,
  amountPerLevel,
  extraAmountOnlyOneIngredient: 0,
  recover: true,
});

const recipe = (
  id: string,
  result: string,
  station: string,
  resources: Resource[],
): ValheimRecipe => ({
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
  resources,
});

const smelt = (
  processor: string,
  input: string,
  output: string,
  seconds: number,
): ValheimProcess => ({
  processor,
  inputs: [{ prefab: input, amount: 1 }],
  anyOneOf: false,
  output: { prefab: output, amount: 1 },
  seconds,
  priority: 0,
});

const SMELTER: ValheimProcessor = {
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
};

/** `recipes-vanilla.json` verbatim (pinned by the integration spec). */
export const RECIPES_VANILLA: ValheimRecipesMessage = {
  schemaVersion: 1,
  serverId: 'srv_fixture_01',
  capturedAt: '2026-10-17T20:15:00Z',
  gameVersion: '0.220.5',
  modVersion: '1.0.0',
  kind: 'recipes',
  locale: 'English',
  atlas: null,
  stations: [
    {
      prefab: 'piece_workbench',
      name: 'Workbench',
      maxLevel: 5,
      stackableExtension: false,
      icon: null,
    },
    {
      prefab: 'forge',
      name: 'Forge',
      maxLevel: 7,
      stackableExtension: false,
      icon: null,
    },
  ],
  recipes: [
    recipe('Recipe_SwordIron', 'SwordIron', 'forge', [
      res('Iron', 20, 10),
      res('Wood', 2, 1),
      res('LeatherScraps', 3, 1),
    ]),
    recipe('Recipe_Club', 'Club', 'piece_workbench', [res('Wood', 6, 3)]),
  ],
  pieces: [
    {
      prefab: 'piece_chest',
      name: 'Chest',
      category: 'Furniture',
      tool: 'Hammer',
      station: 'piece_workbench',
      icon: null,
      resources: [{ prefab: 'Wood', amount: 10, recover: true }],
    },
  ],
  processors: [SMELTER],
  processes: [smelt('smelter', 'IronScrap', 'Iron', 31)],
};

/** The vanilla fixture + the Bronze chain — what the seed imports. */
export const RECIPES_DEMO_MESSAGE: ValheimRecipesMessage = {
  ...RECIPES_VANILLA,
  recipes: [
    ...RECIPES_VANILLA.recipes,
    recipe('Recipe_Bronze', 'Bronze', 'forge', [
      res('Copper', 2),
      res('Tin', 1),
    ]),
    recipe('Recipe_SwordBronze', 'SwordBronze', 'forge', [
      res('Bronze', 8, 4),
      res('Wood', 2),
      res('LeatherScraps', 3),
    ]),
  ],
  processors: [
    { ...SMELTER, prefab: 'charcoal_kiln', fuel: null, fuelPerProduct: null },
    SMELTER,
  ],
  processes: [
    smelt('charcoal_kiln', 'Wood', 'Coal', 15),
    ...RECIPES_VANILLA.processes,
    smelt('smelter', 'CopperOre', 'Copper', 30),
    smelt('smelter', 'TinOre', 'Tin', 30),
  ],
};

const item = (
  name: string,
  cell: number,
  maxQuality = 1,
  category = 'Material',
): ValheimItemCatalogEntryRow => ({
  name,
  category,
  maxStack: maxQuality > 1 ? 1 : 50,
  maxQuality,
  variants: 0,
  icon: { kind: 'atlas', x: cell * 64, y: 0, w: 64, h: 64 },
});

/** Merged into the armory fixture catalogue (same 256×64 atlas, 4 cells). */
export const RECIPES_DEMO_ITEMS: Record<string, ValheimItemCatalogEntryRow> = {
  SwordBronze: item('Bronze sword', 1, 4, 'OneHandedWeapon'),
  Bronze: item('Bronze', 1),
  Copper: item('Copper', 1),
  Tin: item('Tin', 0),
  CopperOre: item('Copper ore', 1),
  TinOre: item('Tin ore', 0),
  Coal: item('Coal', 3),
  LeatherScraps: item('Leather scraps', 2),
  Iron: item('Iron', 0),
  IronScrap: item('Scrap iron', 0),
};

/** The one chest the planner fixture adds to the containers scan. */
export const DEMO_COPPER_CHEST: ValheimContainer = {
  prefab: 'piece_chest_wood',
  x: 30,
  y: 32.5,
  z: 30,
  creatorPlayerId: '1000000000000002',
  privacy: 'public',
  vehicle: false,
  slots: 10,
  usedSlots: 1,
  unreadable: false,
  omittedEntries: 0,
  items: [{ prefab: 'Copper', quality: 1, stack: 40 }],
};

/** The containers seed's merged scan + the copper chest (same world). */
export const RECIPES_DEMO_STOCK: ValheimContainersMessage = {
  ...CONTAINERS_DEMO_MESSAGE,
  containers: [...CONTAINERS_DEMO_MESSAGE.containers, DEMO_COPPER_CHEST],
};
