// ROK-1854 — `recipes` fixtures. Synthetic names only (CONTRACT §8). Imported by gen-valheim-link-fixtures.mjs.
export function recipesFixtures(header) {
    const base = { ...header, kind: 'recipes', locale: 'English' };
    const station = (prefab, name, maxLevel, icon = null) => ({ prefab, name, maxLevel, stackableExtension: false, icon });
    const res = (prefab, amount, amountPerLevel = 0, extra = {}) => ({ prefab, amount, amountPerLevel, extraAmountOnlyOneIngredient: 0, recover: true, ...extra });
    const recipe = (id, result, station, resources, extra = {}) => ({
        id, result, amount: 1, enabled: true, station, repairStation: station, minStationLevel: 1, upgradeOnly: false,
        anyOneOf: false, qualityResultAmountMultiplier: 1, formula: 'vanilla', resources, ...extra,
    });
    const piece = (prefab, name, category, station, resources, icon = null) => ({ prefab, name, category, tool: 'Hammer', station, icon, resources });
    const pres = (prefab, amount) => ({ prefab, amount, recover: true });
    const atlas = { sha256: 'd'.repeat(64), byteLength: 65_536, contentType: 'image/png', width: 256, height: 256 };
    const icon = (x, y) => ({ kind: 'atlas', x, y, w: 64, h: 64 });
    const smelter = { prefab: 'smelter', type: 'smelter', fuel: 'Coal', fuelPerProduct: 2, fuelSecondsPerUnit: null, windPowered: false, requiresRoof: false, maxInput: 10, burntResult: null, defaultResult: null };
    const vanilla = {
        ...base,
        atlas: null,
        stations: [station('piece_workbench', 'Workbench', 5), station('forge', 'Forge', 7)],
        recipes: [
            recipe('Recipe_SwordIron', 'SwordIron', 'forge', [res('Iron', 20, 10), res('Wood', 2, 1), res('LeatherScraps', 3, 1)]),
            recipe('Recipe_Club', 'Club', 'piece_workbench', [res('Wood', 6, 3)]),
        ],
        pieces: [piece('piece_chest', 'Chest', 'Furniture', 'piece_workbench', [pres('Wood', 10)])],
        processors: [smelter],
        processes: [{ processor: 'smelter', inputs: [{ prefab: 'IronScrap', amount: 1 }], anyOneOf: false, output: { prefab: 'Iron', amount: 1 }, seconds: 31, priority: 0 }],
    };
    const processing = {
        ...base,
        atlas,
        stations: [station('piece_workbench', 'Workbench', 5, icon(0, 0)), station('piece_cauldron', 'Cauldron', 4, icon(64, 0))],
        recipes: [recipe('Recipe_MeadBase', 'MeadBaseHealthMinor', 'piece_cauldron', [res('Honey', 10), res('Blueberries', 5), res('Raspberry', 10), res('Dandelion', 1)], { anyOneOf: false })],
        pieces: [
            piece('piece_chest', 'Chest', 'Furniture', 'piece_workbench', [pres('Wood', 10)], icon(128, 0)),
            piece('fermenter', 'Fermenter', 'Crafting', 'piece_workbench', [pres('FineWood', 30), pres('Bronze', 5), pres('Resin', 10)], icon(192, 0)),
        ],
        processors: [
            { prefab: 'fermenter', type: 'fermenter', fuel: null, fuelPerProduct: null, fuelSecondsPerUnit: null, windPowered: false, requiresRoof: true, maxInput: 1, burntResult: null, defaultResult: null },
            { prefab: 'piece_cookingstation', type: 'cooking', fuel: null, fuelPerProduct: null, fuelSecondsPerUnit: null, windPowered: false, requiresRoof: false, maxInput: 2, burntResult: 'CookedMeatBurnt', defaultResult: null },
            { prefab: 'incinerator', type: 'incinerator', fuel: null, fuelPerProduct: null, fuelSecondsPerUnit: null, windPowered: false, requiresRoof: false, maxInput: null, burntResult: null, defaultResult: { prefab: 'Coal', perInputs: 1 } },
        ],
        processes: [
            { processor: 'fermenter', inputs: [{ prefab: 'MeadBaseHealthMinor', amount: 1 }], anyOneOf: false, output: { prefab: 'MeadHealthMinor', amount: 6 }, seconds: 2400, priority: 0 },
            { processor: 'piece_cookingstation', inputs: [{ prefab: 'RawMeat', amount: 1 }], anyOneOf: false, output: { prefab: 'CookedMeat', amount: 1 }, seconds: 25, priority: 0 },
            { processor: 'incinerator', inputs: [{ prefab: 'Wood', amount: 1 }, { prefab: 'Stone', amount: 1 }], anyOneOf: true, output: { prefab: 'Coal', amount: 1 }, seconds: null, priority: -1 },
        ],
    };
    const valid = { 'recipes-vanilla': vanilla, 'recipes-processing': processing };
    const withRecipe = (r) => ({ ...vanilla, recipes: [r] });
    const invalid = {
        'recipes-unknown-station': [withRecipe(recipe('r', 'SwordIron', 'piece_forge_missing', [res('Iron', 1)])), { path: 'recipes.0.station', code: 'custom' }],
        'recipes-duplicate-id': [{ ...vanilla, recipes: [vanilla.recipes[0], vanilla.recipes[0]] }, { path: 'recipes.1.id', code: 'custom' }],
        'recipes-duplicate-resource': [withRecipe(recipe('r', 'SwordIron', 'forge', [res('Iron', 1), res('Iron', 2)])), { path: 'recipes.0.resources.1.prefab', code: 'custom' }],
        'recipes-duplicate-station': [{ ...vanilla, stations: [vanilla.stations[0], vanilla.stations[0]] }, { path: 'stations.1.prefab', code: 'custom' }],
        'recipes-piece-unknown-station': [{ ...vanilla, pieces: [piece('p', 'P', 'Misc', 'nope', [])] }, { path: 'pieces.0.station', code: 'custom' }],
        'recipes-process-unknown-processor': [{ ...vanilla, processes: [{ ...vanilla.processes[0], processor: 'kiln' }] }, { path: 'processes.0.processor', code: 'custom' }],
        'recipes-process-duplicate-input': [{ ...vanilla, processes: [{ ...vanilla.processes[0], inputs: [{ prefab: 'IronScrap', amount: 1 }, { prefab: 'IronScrap', amount: 2 }] }] }, { path: 'processes.0.inputs.1.prefab', code: 'custom' }],
        'recipes-icon-without-atlas': [{ ...vanilla, stations: [station('piece_workbench', 'Workbench', 5, icon(0, 0)), vanilla.stations[1]] }, { path: 'atlas', code: 'custom' }],
        'recipes-icon-outside-atlas': [{ ...processing, pieces: [piece('piece_chest', 'Chest', 'Furniture', 'piece_workbench', [], icon(240, 0)), processing.pieces[1]] }, { path: 'pieces.0.icon', code: 'custom' }],
        'recipes-station-level-zero': [{ ...vanilla, stations: [station('piece_workbench', 'Workbench', 0), vanilla.stations[1]] }, { path: 'stations.0.maxLevel', code: 'too_small' }],
        'recipes-bad-processor-type': [{ ...vanilla, processors: [{ ...smelter, type: 'forge' }] }, { path: 'processors.0.type', code: 'invalid_value' }],
        'recipes-unknown-key': [{ ...vanilla, recipes: [{ ...vanilla.recipes[1], owner: 'x' }] }, { path: 'recipes.0', code: 'unrecognized_keys' }],
    };
    return { valid, invalid };
}
