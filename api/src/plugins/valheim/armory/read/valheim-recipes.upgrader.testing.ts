/**
 * ROK-1861 D9 — an inline Valheim 1.0.20 recipes set with an upgrade
 * station, until the mod exports a real one. `upgrader_test` is synthetic:
 * the real upgrader prefab names are UNVERIFIED (spec §1.1). Values on
 * `Recipe_ArmorBronzeChest` are the ROK-1894 measured ones.
 */
import type {
  ValheimCraftingStation,
  ValheimRecipe,
  ValheimRecipeResource,
} from '@raid-ledger/contract';
import type { RecipeGraphRows } from './valheim-recipes.graph';

export const UPGRADER_TEST_STATION = 'upgrader_test';

function resource(
  prefab: string,
  amount: number,
  amountPerLevel: number,
  upgraderResource?: boolean,
): ValheimRecipeResource {
  return {
    prefab,
    amount,
    amountPerLevel,
    extraAmountOnlyOneIngredient: 0,
    recover: true,
    ...(upgraderResource === undefined ? {} : { upgraderResource }),
  };
}

function recipe(
  id: string,
  result: string,
  station: string,
  resources: ValheimRecipeResource[],
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
    resources,
  };
}

function station(
  prefab: string,
  name: string,
  upgrader: boolean,
): ValheimCraftingStation {
  const maxLevel = upgrader ? 4 : 7;
  return { prefab, name, maxLevel, stackableExtension: false, upgrader, icon: null };
}

/** Bronze cuirass at the upgrader, a Bronze sword at the (plain) forge, Bronze at the forge. */
export function upgraderRecipeRows(): RecipeGraphRows {
  return {
    gameVersion: '1.0.20',
    stations: [
      station('forge', 'Forge', false),
      station(UPGRADER_TEST_STATION, 'Upgrade station', true),
    ],
    pieces: [
      {
        prefab: UPGRADER_TEST_STATION,
        name: 'Upgrade station',
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
    recipes: [
      recipe('Recipe_ArmorBronzeChest', 'ArmorBronzeChest', UPGRADER_TEST_STATION, [
        resource('Bronze', 5, 3),
        resource('DeerHide', 2, 0),
        resource('Upgrader1Armor', 1, 0, true),
      ]),
      recipe('Recipe_SwordBronze', 'SwordBronze', 'forge', [
        resource('Bronze', 8, 4),
        resource('Wood', 2, 0),
      ]),
      recipe('Recipe_Bronze', 'Bronze', 'forge', [
        resource('Copper', 2, 0),
        resource('Tin', 1, 0),
      ]),
    ],
    processors: [],
    processes: [],
  };
}
