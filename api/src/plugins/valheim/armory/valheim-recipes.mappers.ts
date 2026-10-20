/**
 * ROK-1854 L2 — pure mappers from a re-validated `recipes` message to
 * recipe-set row values (D3). Requirement lists are carried raw into jsonb;
 * Raid Ledger evaluates the per-quality formula at read time (D2). No I/O.
 */
import type { ValheimRecipesMessage } from '@raid-ledger/contract';
import type {
  NewValheimPiece,
  NewValheimProcess,
  NewValheimProcessor,
  NewValheimRecipe,
  NewValheimRecipeSet,
  NewValheimRecipeStation,
} from '../../../drizzle/schema';
import type { ArmorySnapshot } from './valheim-armory.mappers';

/** The set row: one per (server, gameVersion); atlas columns null without one. */
export function toRecipeSetValues(
  snap: ArmorySnapshot,
  msg: ValheimRecipesMessage,
): NewValheimRecipeSet {
  return {
    pelicanServerId: snap.pelicanServerId,
    gameVersion: msg.gameVersion,
    locale: msg.locale,
    capturedAt: new Date(msg.capturedAt),
    atlasSha256: msg.atlas?.sha256 ?? null,
    atlasWidth: msg.atlas?.width ?? null,
    atlasHeight: msg.atlas?.height ?? null,
    sourceSnapshotId: snap.id,
  };
}

/** Crafting stations; `upgrader` is absent on 0.221.x exports → false. */
export function toStationRows(
  setId: number,
  msg: ValheimRecipesMessage,
): NewValheimRecipeStation[] {
  return msg.stations.map((s) => ({
    setId,
    prefab: s.prefab,
    name: s.name,
    maxLevel: s.maxLevel,
    stackableExtension: s.stackableExtension,
    upgrader: s.upgrader ?? false,
    icon: s.icon,
  }));
}

/** Recipes keyed by the wire `id`; `resources` stored raw. */
export function toRecipeRows(
  setId: number,
  msg: ValheimRecipesMessage,
): NewValheimRecipe[] {
  return msg.recipes.map((r) => ({
    setId,
    recipeId: r.id,
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
  }));
}

/** Build pieces; `resources` stored raw. */
export function toPieceRows(
  setId: number,
  msg: ValheimRecipesMessage,
): NewValheimPiece[] {
  return msg.pieces.map((p) => ({
    setId,
    prefab: p.prefab,
    name: p.name,
    category: p.category,
    tool: p.tool,
    station: p.station,
    icon: p.icon,
    resources: p.resources,
  }));
}

/** Smelters, fermenters, cooking stations, obliterators. */
export function toProcessorRows(
  setId: number,
  msg: ValheimRecipesMessage,
): NewValheimProcessor[] {
  return msg.processors.map((p) => ({
    setId,
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
  }));
}

/** Processes keep their wire order as `ord` (the mod's priority sort). */
export function toProcessRows(
  setId: number,
  msg: ValheimRecipesMessage,
): NewValheimProcess[] {
  return msg.processes.map((p, ord) => ({
    setId,
    ord,
    processor: p.processor,
    inputs: p.inputs,
    anyOneOf: p.anyOneOf,
    outputPrefab: p.output.prefab,
    outputAmount: p.output.amount,
    seconds: p.seconds,
    priority: p.priority,
  }));
}
