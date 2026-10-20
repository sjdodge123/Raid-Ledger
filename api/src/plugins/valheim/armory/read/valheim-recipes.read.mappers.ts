/**
 * ROK-1854 L3 — pure parts of the recipe read routes: stored rows → the
 * graph's wire-typed input, query parsing (400s) and stock netting input.
 * No Nest DI, no I/O.
 */
import { BadRequestException } from '@nestjs/common';
import {
  VALHEIM_PLAN_TARGETS_MAX,
  ValheimPrefabIdSchema,
  ValheimRecipePlanTargetSchema,
  type ValheimRecipePlanTarget,
} from '@raid-ledger/contract';
import type { RecipeSetRows } from '../valheim-recipes.repository';
import type { RecipeGraph, RecipeGraphRows } from './valheim-recipes.graph';
import type { MaterialsTotalRow } from './valheim-materials.mappers';

/** Identical body for "no set", "no source" and "not a piece". */
export const RECIPE_NOT_FOUND = 'Recipe not found';

export type RecipeKind = 'item' | 'piece';

/** DB rows → `RecipeGraphRows` (columns mirror the wire fields). */
export function toRecipeGraphRows(rows: RecipeSetRows): RecipeGraphRows {
  return {
    stations: rows.stations.map((s) => ({
      prefab: s.prefab,
      name: s.name,
      maxLevel: s.maxLevel,
      stackableExtension: s.stackableExtension,
      upgrader: s.upgrader,
      icon: s.icon,
    })),
    recipes: rows.recipes.map((r) => ({
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
    })),
    pieces: rows.pieces.map((p) => ({
      prefab: p.prefab,
      name: p.name,
      category: p.category,
      tool: p.tool,
      station: p.station,
      icon: p.icon,
      resources: p.resources,
    })),
    processors: rows.processors.map((p) => ({
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
    })),
    processes: rows.processes.map((p) => ({
      processor: p.processor,
      inputs: p.inputs,
      anyOneOf: p.anyOneOf,
      output: { prefab: p.outputPrefab, amount: p.outputAmount },
      seconds: p.seconds,
      priority: p.priority,
    })),
  };
}

const INT_RE = /^\d{1,6}$/;

function toInt(raw: string | undefined): number | null {
  return raw !== undefined && INT_RE.test(raw) ? Number(raw) : null;
}

/** `:prefab` path param, else 400. */
export function parseRecipePrefab(raw: unknown): string {
  const parsed = ValheimPrefabIdSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException('Invalid prefab');
  return parsed.data;
}

/** `?quality=` 1–10, default 1; anything else 400 (clamped later). */
export function parseTreeQuality(raw: unknown): number {
  if (raw === undefined) return 1;
  const q = typeof raw === 'string' ? toInt(raw) : null;
  if (q === null || q < 1 || q > 10) {
    throw new BadRequestException('Invalid quality');
  }
  return q;
}

/** `?kind=item|piece`; absent → undefined (resolver picks). */
export function parseTreeKind(raw: unknown): RecipeKind | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'item' || raw === 'piece') return raw;
  throw new BadRequestException('Invalid kind');
}

/** `?includePersonal=` — default false (design §3.3 item 3). */
export function parseIncludePersonal(raw: unknown): boolean {
  if (raw === undefined || raw === 'false') return false;
  if (raw === 'true') return true;
  throw new BadRequestException('Invalid includePersonal');
}

function parseTarget(part: string): ValheimRecipePlanTarget {
  const bits = part.split(':');
  if (bits.length < 3 || bits.length > 4) {
    throw new BadRequestException('Invalid targets');
  }
  const [prefab, q, n, from] = bits;
  const parsed = ValheimRecipePlanTargetSchema.safeParse({
    prefab,
    quality: toInt(q),
    amount: toInt(n),
    fromQuality: from === undefined ? 0 : toInt(from),
  });
  if (!parsed.success) throw new BadRequestException('Invalid targets');
  return parsed.data;
}

/** `targets=<prefab>:<q>:<n>[:<fromQ>],…` — 1..MAX targets, else 400. */
export function parsePlanTargets(raw: unknown): ValheimRecipePlanTarget[] {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new BadRequestException('Invalid targets');
  }
  const parts = raw.split(',');
  if (parts.length > VALHEIM_PLAN_TARGETS_MAX) {
    throw new BadRequestException('Too many targets');
  }
  return parts.map(parseTarget);
}

/** 404 rule for `/tree`: the prefab has a source of the asked kind. */
export function hasTreeTarget(
  graph: RecipeGraph,
  prefab: string,
  kind: RecipeKind | undefined,
): boolean {
  const piece = graph.pieces.has(prefab);
  const item =
    graph.recipesByResult.has(prefab) || graph.processesByOutput.has(prefab);
  if (kind === 'piece') return piece;
  if (kind === 'item') return item;
  return piece || item;
}

/** D7: stock per prefab, summed over every quality. */
export function toStockMap(
  rows: readonly MaterialsTotalRow[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.prefab, (out.get(r.prefab) ?? 0) + Number(r.total));
  }
  return out;
}
