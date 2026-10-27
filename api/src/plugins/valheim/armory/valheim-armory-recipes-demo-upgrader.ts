/**
 * ROK-1861 — DEMO_MODE opt-in (`recipes-fixture { upgrader: true }`): the
 * recipes demo set plus a Bronze cuirass made and upgraded at an upgrade
 * station ("Armor upgrader", built at the Forge), so the Planner shows its
 * quality steps and the optional station build. Same `capturedAt` and
 * snapshot key as the base set, so the plain seed rewrites it back (and
 * strips the catalogue entries below — `stripRecipesDemoUpgraderCatalog`). The
 * station prefab is synthetic — the real 1.0.20 upgrader ids are UNVERIFIED
 * (spec §1.1). Values on the cuirass are the ROK-1894 measured ones.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  ValheimRecipe,
  ValheimRecipesMessage,
} from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import { ARMORY_FIXTURE_GAME_VERSION } from './valheim-armory-demo-seed.helpers';
import { RECIPES_DEMO_MESSAGE as BASE } from './valheim-armory-recipes-demo-fixture';
import {
  importRecipesDemoSet,
  mergeRecipesDemoCatalog,
  RECIPES_DEMO_ALL_KNOWN,
} from './valheim-armory-recipes-demo-seed.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Resource = ValheimRecipe['resources'][number];

export const DEMO_UPGRADER_STATION = 'piece_upgrader_armor_demo';
const NAME = 'Armor upgrader';

const res = (
  prefab: string,
  amount: number,
  perLevel: number,
  upgraderResource?: true,
): Resource => ({
  prefab,
  amount,
  amountPerLevel: perLevel,
  extraAmountOnlyOneIngredient: 0,
  recover: true,
  ...(upgraderResource === undefined ? {} : { upgraderResource }),
});

const CUIRASS: ValheimRecipe = {
  id: 'Recipe_ArmorBronzeChest',
  result: 'ArmorBronzeChest',
  amount: 1,
  enabled: true,
  station: DEMO_UPGRADER_STATION,
  repairStation: DEMO_UPGRADER_STATION,
  minStationLevel: 1,
  upgradeOnly: false,
  anyOneOf: false,
  qualityResultAmountMultiplier: 1,
  formula: 'vanilla',
  resources: [
    res('Bronze', 5, 3),
    res('DeerHide', 2, 0),
    res('Upgrader1Armor', 1, 0, true),
  ],
};

export const RECIPES_DEMO_UPGRADER_MESSAGE: ValheimRecipesMessage = {
  ...BASE,
  stations: [
    ...BASE.stations,
    {
      prefab: DEMO_UPGRADER_STATION,
      name: NAME,
      maxLevel: 4,
      stackableExtension: false,
      upgrader: true,
      icon: null,
    },
  ],
  pieces: [
    ...BASE.pieces,
    {
      prefab: DEMO_UPGRADER_STATION,
      name: NAME,
      category: 'Crafting',
      tool: 'Hammer',
      station: 'forge',
      icon: null,
      resources: [
        { prefab: 'Stone', amount: 10, recover: true },
        { prefab: 'Bronze', amount: 2, recover: true },
      ],
    },
  ],
  recipes: [...BASE.recipes, CUIRASS],
};

const cell = (
  name: string,
  x: number,
  maxQuality = 1,
  category = 'Material',
): schema.ValheimItemCatalogEntryRow => ({
  name,
  category,
  maxStack: maxQuality > 1 ? 1 : 50,
  maxQuality,
  variants: 0,
  icon: { kind: 'atlas', x: x * 64, y: 0, w: 64, h: 64 },
});

const UPGRADER_ITEMS: Record<string, schema.ValheimItemCatalogEntryRow> = {
  ArmorBronzeChest: cell('Bronze cuirass', 1, 4, 'Chest'),
  DeerHide: cell('Deer hide', 2),
  Upgrader1Armor: cell('Armor upgrade kit', 3),
  Stone: cell('Stone', 0),
};

/** Plain seed: drop the upgrader-only catalogue keys (none is in the base catalogue). */
export async function stripRecipesDemoUpgraderCatalog(
  db: Db,
  serverId: number,
): Promise<void> {
  const C = schema.valheimItemCatalogs;
  const keys = `{${Object.keys(UPGRADER_ITEMS).join(',')}}`;
  await db
    .update(C)
    .set({ items: sql`${C.items} - ${keys}::text[]` })
    .where(
      and(
        eq(C.pelicanServerId, serverId),
        eq(C.gameVersion, ARMORY_FIXTURE_GAME_VERSION),
      ),
    );
}

/** Import the extended set and let the unclaimed scout know the cuirass and the station. */
export async function seedRecipesDemoUpgrader(
  db: Db,
  serverId: number,
  scoutId: number,
): Promise<void> {
  await mergeRecipesDemoCatalog(db, serverId, UPGRADER_ITEMS);
  await importRecipesDemoSet(db, serverId, RECIPES_DEMO_UPGRADER_MESSAGE);
  const P = schema.valheimProfiles;
  await db
    .update(P)
    .set({
      knownRecipes: [
        ...RECIPES_DEMO_ALL_KNOWN,
        'ArmorBronzeChest',
        DEMO_UPGRADER_STATION,
      ],
    })
    .where(eq(P.id, scoutId));
}
