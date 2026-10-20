/**
 * ROK-1854 L3 — stored recipe-set rows → the graph's wire-typed input
 * (`RecipeGraphRows`). The columns mirror the wire fields one-for-one; the
 * jsonb `resources` / `inputs` columns carry the raw wire lists. Pure.
 */
import type { RecipeSetRows } from '../valheim-recipes.repository';
import type { RecipeGraphRows } from './valheim-recipes.graph';

type Rows = RecipeSetRows;
type Wire = RecipeGraphRows;

function toStation(s: Rows['stations'][number]): Wire['stations'][number] {
  return {
    prefab: s.prefab,
    name: s.name,
    maxLevel: s.maxLevel,
    stackableExtension: s.stackableExtension,
    upgrader: s.upgrader,
    icon: s.icon,
  };
}

/** `recipeId` column ↔ wire `id`; `resources` jsonb is the raw wire list. */
function toRecipe(r: Rows['recipes'][number]): Wire['recipes'][number] {
  return {
    id: r.recipeId,
    result: r.result,
    amount: r.amount,
    enabled: r.enabled,
    station: r.station,
    repairStation: r.repairStation,
    minStationLevel: r.minStationLevel,
    upgradeOnly: r.upgradeOnly,
    anyOneOf: r.anyOneOf,
    qualityResultAmountMultiplier: r.qualityResultAmountMultiplier,
    formula: r.formula,
    resources: r.resources,
  };
}

function toPiece(p: Rows['pieces'][number]): Wire['pieces'][number] {
  return {
    prefab: p.prefab,
    name: p.name,
    category: p.category,
    tool: p.tool,
    station: p.station,
    icon: p.icon,
    resources: p.resources,
  };
}

function toProcessor(
  p: Rows['processors'][number],
): Wire['processors'][number] {
  return {
    prefab: p.prefab,
    type: p.type,
    fuel: p.fuel,
    fuelPerProduct: p.fuelPerProduct,
    fuelSecondsPerUnit: p.fuelSecondsPerUnit,
    windPowered: p.windPowered,
    requiresRoof: p.requiresRoof,
    maxInput: p.maxInput,
    burntResult: p.burntResult,
    defaultResult: p.defaultResult,
  };
}

/** `outputPrefab`/`outputAmount` ↔ wire `output`; rows arrive in `ord` order. */
function toProcess(p: Rows['processes'][number]): Wire['processes'][number] {
  return {
    processor: p.processor,
    inputs: p.inputs,
    anyOneOf: p.anyOneOf,
    output: { prefab: p.outputPrefab, amount: p.outputAmount },
    seconds: p.seconds,
    priority: p.priority,
  };
}

/** DB rows → `RecipeGraphRows` (columns mirror the wire fields). */
export function toRecipeGraphRows(rows: RecipeSetRows): RecipeGraphRows {
  return {
    stations: rows.stations.map(toStation),
    recipes: rows.recipes.map(toRecipe),
    pieces: rows.pieces.map(toPiece),
    processors: rows.processors.map(toProcessor),
    processes: rows.processes.map(toProcess),
  };
}
