/**
 * ROK-1899 — a small crafting catalogue for the window's hook and component
 * tests: Bronze (Copper + Tin) at the Forge, a Bronze buckler at the
 * Workbench (so "bro" spans two stations), an upgradable Bronze axe, a
 * by-hand Club, a ×20 Wood arrow, a piece and two process outputs
 * (ROK-1934: Copper at the smelter, Cooked meat at the cooking station).
 */
import type { ValheimRecipeCatalogEntry, ValheimRecipeCost, ValheimRecipeStation } from '@raid-ledger/contract';

type Res = [string, number][];

const cost = (station: string | null, stationLevel: number, resources: Res): ValheimRecipeCost => ({
    station,
    stationLevel,
    anyOneOf: false,
    resources: resources.map(([prefab, amount]) => ({ prefab, amount })),
});

function item(prefab: string, name: string, station: string | null, resources: Res, over: Partial<ValheimRecipeCatalogEntry> = {}): ValheimRecipeCatalogEntry {
    return {
        prefab, kind: 'item', name, category: 'Weapon', icon: null, maxQuality: 1, sources: { recipes: 1, processes: 0 },
        craft: { ...cost(station, 1, resources), via: 'recipe', amount: 1 }, upgrades: [], ...over,
    };
}

export const CRAFT_STATIONS: ValheimRecipeStation[] = [
    { prefab: 'piece_workbench', name: 'Workbench', maxLevel: 5, upgrader: false, icon: null },
    { prefab: 'forge', name: 'Forge', maxLevel: 7, upgrader: false, icon: null },
];

export const CRAFT_ENTRIES: ValheimRecipeCatalogEntry[] = [
    item('Bronze', 'Bronze', 'forge', [['Copper', 2], ['Tin', 1]], { category: 'Material' }),
    item('BronzeNails', 'Bronze nails', 'forge', [['Bronze', 1]], {
        category: 'Material',
        craft: { ...cost('forge', 1, [['Bronze', 1]]), via: 'recipe', amount: 20 },
    }),
    item('AxeBronze', 'Bronze axe', 'forge', [['Wood', 4], ['Bronze', 8]], {
        maxQuality: 4,
        upgrades: [2, 3, 4].map((q) => ({ ...cost('forge', q, [['Wood', 2], ['Bronze', 2 * q]]), quality: q, upgraderStation: false })),
    }),
    item('ShieldBronzeBuckler', 'Bronze buckler', 'piece_workbench', [['Wood', 4], ['Bronze', 10]], {
        craft: { ...cost('piece_workbench', 2, [['Wood', 4], ['Bronze', 10]]), via: 'recipe', amount: 1 },
    }),
    item('Club', 'Club', null, [['Wood', 6]]),
    item('ArrowWood', 'Wood arrow', 'piece_workbench', [['Wood', 8], ['Feathers', 2]], {
        craft: { ...cost('piece_workbench', 1, [['Wood', 8], ['Feathers', 2]]), via: 'recipe', amount: 20 },
    }),
    { ...item('piece_chest_wood', 'Chest', null, [['Wood', 10]]), kind: 'piece', category: 'Furniture' },
    item('Copper', 'Copper', 'smelter', [['CopperOre', 1]], {
        category: 'Material',
        craft: { ...cost('smelter', 0, [['CopperOre', 1]]), via: 'process', amount: 1 },
    }),
    item('CookedMeat', 'Cooked meat', 'piece_cookingstation', [['RawMeat', 1]], {
        category: 'Food',
        craft: { ...cost('piece_cookingstation', 0, [['RawMeat', 1]]), via: 'process', amount: 1 },
    }),
];

/** 40 Copper and no Tin: Bronze is short by one Tin; Club is affordable. */
export const CRAFT_TOTALS: Readonly<Record<string, number>> = { Copper: 40, Wood: 10 };
