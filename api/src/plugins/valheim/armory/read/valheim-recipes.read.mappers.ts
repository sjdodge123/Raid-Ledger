/**
 * ROK-1854 L3 — pure parts of the recipe read routes: query parsing (400s),
 * the `/tree` 404 rule, stock netting input and empty bodies. No Nest DI.
 */
import { BadRequestException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  VALHEIM_PLAN_TARGETS_MAX,
  ValheimPrefabIdSchema,
  ValheimRecipePlanTargetSchema,
  type ValheimRecipeCatalogResponse,
  type ValheimRecipePlanResponse,
  type ValheimRecipePlanTarget,
} from '@raid-ledger/contract';
import type { AuthenticatedUser } from '../../../../auth/types';
import type { ValheimContainerScan } from '../../../../drizzle/schema';
import type { RecipeGraph } from './valheim-recipes.graph';
import type { MaterialsTotalRow } from './valheim-materials.mappers';
import {
  sharedSql,
  toMaterialsViewer,
  vehicleSql,
  visibleSql,
} from './valheim-materials.privacy';
import type { RecipesReader } from './valheim-recipes.read.repository';

/** Identical body for "no set", "no source" and "not a piece". */
export const RECIPE_NOT_FOUND = 'Recipe not found';

export type RecipeKind = 'item' | 'piece';

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

/** Stock options for `/plan` (D7). */
export interface PlanStockOptions {
  includePersonal: boolean;
  includeVehicles: boolean;
}

/** D7: shared chests, plus the viewer's own personal ones when asked. */
export function stockScope(
  user: AuthenticatedUser,
  opts: PlanStockOptions,
): SQL {
  const visible = opts.includePersonal
    ? visibleSql(toMaterialsViewer(user))
    : sharedSql;
  return sql`(${visible} AND ${vehicleSql(opts.includeVehicles)})`;
}

/** The newest scan and its per-prefab stock in `scope`; no scan → nulls. */
export async function loadStock(
  r: RecipesReader,
  serverId: number,
  scope: SQL,
): Promise<{
  scan: ValheimContainerScan | null;
  stock: Map<string, number> | null;
}> {
  const scan = await r.materials.latestScan(serverId);
  if (!scan) return { scan: null, stock: null };
  return { scan, stock: toStockMap(await r.materials.totals(scan.id, scope)) };
}

/** Each target's quality clamped to its item's `maxQuality` (spec §2.5). */
export function clampTargets(
  targets: readonly ValheimRecipePlanTarget[],
  maxQuality: (prefab: string) => number,
): ValheimRecipePlanTarget[] {
  return targets.map((t) => ({
    ...t,
    quality: Math.min(t.quality, maxQuality(t.prefab)),
  }));
}

/** No recipes snapshot yet. */
export function emptyCatalogue(): ValheimRecipeCatalogResponse {
  return {
    gameVersion: null,
    capturedAt: null,
    catalogFallback: false,
    entries: [],
    stations: [],
    itemAtlas: null,
    recipeAtlas: null,
  };
}

/** No recipes snapshot yet: the targets echoed, nothing resolved. */
export function emptyPlan(
  targets: ValheimRecipePlanTarget[],
): ValheimRecipePlanResponse {
  return {
    targets,
    nodes: [],
    truncated: false,
    stock: 'none',
    capturedAt: null,
    shoppingList: [],
    fuelEstimates: [],
    items: {},
    itemAtlas: null,
    recipeAtlas: null,
  };
}
