/**
 * ROK-1854 L3 — the recipe planner reads: catalogue, one target's craft
 * tree, a multi-target plan netted against the viewer's chest stock. Order
 * in every handler: hub exists + visible (404) → one read transaction →
 * newest set (D6; none → empty / 404 for a tree) → graph (LRU, D5) → work.
 * Every response is parsed through its contract schema before it leaves.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import {
  ValheimRecipeCatalogResponseSchema,
  VALHEIM_PLAN_QUANTITY_MAX,
  ValheimRecipePlanResponseSchema,
  ValheimRecipeStockResponseSchema,
  ValheimRecipeTreeResponseSchema,
  type ValheimRecipeCatalogResponse,
  type ValheimRecipePlanResponse,
  type ValheimRecipePlanTarget,
  type ValheimRecipeStockResponse,
  type ValheimRecipeTreeResponse,
} from '@raid-ledger/contract';
import type { AuthenticatedUser } from '../../../../auth/types';
import type { ValheimRecipeSetRow } from '../../../../drizzle/schema';
import { projectCatalog } from './valheim-armory-catalog.helpers';
import { ValheimArmoryReadRepository } from './valheim-armory-read.repository';
import { assertServerHubVisible } from './valheim-hub-guard.helpers';
import { toMinuteIso } from './valheim-materials.mappers';
import {
  catalogueEntries,
  catalogueReadPrefabs,
  ingredientPrefabs,
} from './valheim-recipes.catalog.helpers';
import { RecipeGraphCache } from './valheim-recipes.graph';
import { toRecipeGraphRows } from './valheim-recipes.graph-rows';
import {
  clampTargets,
  emptyCatalogue,
  emptyPlan,
  hasTreeTarget,
  loadStock,
  RECIPE_NOT_FOUND,
  stockScope,
  type PlanStockOptions,
  type RecipeKind,
} from './valheim-recipes.read.mappers';
import {
  ValheimRecipesReadRepository,
  type RecipesReader,
} from './valheim-recipes.read.repository';
import { resolvePlan, resolveTree } from './valheim-recipes.resolve';
import {
  withEntryDiscovery,
  type KnownRecipes,
} from './valheim-recipes.discovery';
import {
  buildsOf,
  catalogFor,
  knownFor,
  nameAndIconOnly,
  nodeCatalog,
  pickTree,
} from './valheim-recipes.service.helpers';
import {
  serverSpoilers,
  shownStations,
  VisibleGraphCache,
  visibleRecipes,
  type VisibleRecipes,
} from './valheim-recipes.spoilers.cache';

/** D8: while protected, hidden targets are dropped (and not echoed). */
function shownTargets(
  vis: VisibleRecipes,
  targets: ValheimRecipePlanTarget[],
): ValheimRecipePlanTarget[] {
  if (vis.spoilers !== 'protected') return targets;
  return targets.filter((t) => hasTreeTarget(vis.graph, t.prefab, t.kind));
}

@Injectable()
export class ValheimRecipesService {
  /** D5: one LRU per API process (the service is a Nest singleton). */
  private readonly graphs = new RecipeGraphCache();
  /** ROK-1948 D5: the spoiler-pruned copy, per server per scan. */
  private readonly visibleGraphs = new VisibleGraphCache();

  constructor(
    private readonly hubs: ValheimArmoryReadRepository,
    private readonly repo: ValheimRecipesReadRepository,
  ) {}

  /** `GET …/servers/:serverId/recipes`. */
  async catalogue(
    serverId: number,
    user: AuthenticatedUser,
  ): Promise<ValheimRecipeCatalogResponse> {
    await assertServerHubVisible(this.hubs, serverId, user);
    const body = await this.repo.read(async (r) => {
      const k = await knownFor(r, serverId, user);
      const set = await r.latestSet(serverId);
      if (!set) {
        const spoilers = await serverSpoilers(r, serverId);
        return { ...emptyCatalogue(), discovery: k.status, spoilers };
      }
      return this.catalogueIn(r, set, k);
    });
    return ValheimRecipeCatalogResponseSchema.parse(body);
  }

  /** One items read names the entries AND their ingredients (ROK-1899). */
  private async catalogueIn(
    r: RecipesReader,
    set: ValheimRecipeSetRow,
    k: KnownRecipes,
  ): Promise<ValheimRecipeCatalogResponse> {
    const { graph, spoilers } = await this.visible(r, set);
    const cat = await r.materials.findCatalog(
      set.pelicanServerId,
      set.gameVersion,
      catalogueReadPrefabs(graph),
    );
    const entries = catalogueEntries(graph, cat?.items ?? null);
    const { items, atlas } = projectCatalog(ingredientPrefabs(entries), cat);
    const ingredients = nameAndIconOnly(items, graph);
    return {
      gameVersion: set.gameVersion,
      capturedAt: toMinuteIso(set.capturedAt),
      catalogFallback: cat !== null && !cat.exact,
      entries: withEntryDiscovery(entries, graph, k),
      discovery: k.status,
      stations: shownStations(graph, entries, spoilers),
      spoilers,
      ingredients,
      itemAtlas: atlas,
      recipeAtlas: await r.recipeAtlas(set),
    };
  }

  /**
   * `GET …/recipes/stock` (ROK-1899) — the viewer's chest totals in the SAME
   * scope `/plan` nets against (D7), summed over qualities; no scan → `none`.
   */
  async stock(
    serverId: number,
    opts: PlanStockOptions,
    user: AuthenticatedUser,
  ): Promise<ValheimRecipeStockResponse> {
    await assertServerHubVisible(this.hubs, serverId, user);
    const scope = stockScope(user, opts);
    const body = await this.repo.read(async (r) => {
      const { scan, stock } = await loadStock(r, serverId, scope);
      const totals = [...(stock ?? [])].map(
        ([prefab, n]) =>
          [prefab, Math.min(n, VALHEIM_PLAN_QUANTITY_MAX)] as const,
      );
      return {
        stock: scan ? ('scan' as const) : ('none' as const),
        capturedAt: scan ? toMinuteIso(scan.capturedAt) : null,
        totals: Object.fromEntries(totals),
      };
    });
    return ValheimRecipeStockResponseSchema.parse(body);
  }

  /** `GET …/recipes/:prefab/tree` — 404 when nothing builds the prefab. */
  async tree(
    serverId: number,
    prefab: string,
    quality: number,
    kind: RecipeKind | undefined,
    user: AuthenticatedUser,
  ): Promise<ValheimRecipeTreeResponse> {
    await assertServerHubVisible(this.hubs, serverId, user);
    const body = await this.repo.read((r) =>
      this.treeIn(r, serverId, { prefab, quality, kind }, user),
    );
    return ValheimRecipeTreeResponseSchema.parse(body);
  }

  private async treeIn(
    r: RecipesReader,
    serverId: number,
    ask: { prefab: string; quality: number; kind: RecipeKind | undefined },
    user: AuthenticatedUser,
  ) {
    const { prefab, kind } = ask;
    const set = await r.latestSet(serverId);
    const vis = set ? await this.visible(r, set) : null;
    // D8: a hidden prefab 404s exactly like one that does not exist.
    if (!set || !vis || !hasTreeTarget(vis.graph, prefab, kind)) {
      throw new NotFoundException(RECIPE_NOT_FOUND);
    }
    const { graph, spoilers } = vis;
    const k = await knownFor(r, serverId, user);
    const { cat, maxQ } = await catalogFor(r, set, graph, [prefab]);
    const q = kind === 'piece' ? 1 : Math.min(ask.quality, maxQ(prefab));
    const target = { prefab, quality: q, amount: 1, fromQuality: 0 };
    const res = resolveTree(graph, kind ? { ...target, kind } : target, null, {
      maxQuality: maxQ,
    });
    return {
      target: { prefab, quality: q },
      ...pickTree(res, graph, k),
      ...nodeCatalog(res, cat, graph),
      recipeAtlas: await r.recipeAtlas(set),
      spoilers,
      ...buildsOf(res),
    };
  }

  /** `GET …/recipes/plan` — stock from the newest scan in the viewer's scope. */
  async plan(
    serverId: number,
    targets: ValheimRecipePlanTarget[],
    opts: PlanStockOptions,
    user: AuthenticatedUser,
  ): Promise<ValheimRecipePlanResponse> {
    await assertServerHubVisible(this.hubs, serverId, user);
    const scope = stockScope(user, opts);
    const body = await this.repo.read(async (r) => {
      const k = await knownFor(r, serverId, user);
      const set = await r.latestSet(serverId);
      if (!set) {
        const spoilers = await serverSpoilers(r, serverId);
        return { ...emptyPlan(targets), discovery: k.status, spoilers };
      }
      return this.planIn(r, set, targets, scope, k);
    });
    return ValheimRecipePlanResponseSchema.parse(body);
  }

  private async planIn(
    r: RecipesReader,
    set: ValheimRecipeSetRow,
    targets: ValheimRecipePlanTarget[],
    scope: SQL,
    k: KnownRecipes,
  ): Promise<ValheimRecipePlanResponse> {
    const { graph, spoilers } = await this.visible(r, set);
    const { scan, stock } = await loadStock(r, set.pelicanServerId, scope);
    const shown = shownTargets({ graph, spoilers }, targets);
    const ids = shown.map((t) => t.prefab);
    const { cat, maxQ } = await catalogFor(r, set, graph, ids);
    const planned = clampTargets(shown, maxQ);
    const res = resolvePlan(graph, planned, stock, { maxQuality: maxQ });
    const { items, itemAtlas } = nodeCatalog(res, cat, graph);
    return {
      targets: planned,
      ...pickTree(res, graph, k),
      stock: scan ? 'scan' : 'none',
      capturedAt: scan ? toMinuteIso(scan.capturedAt) : null,
      shoppingList: res.shoppingList,
      fuelEstimates: res.fuelEstimates,
      items,
      itemAtlas,
      recipeAtlas: await r.recipeAtlas(set),
      spoilers,
      ...buildsOf(res),
    };
  }

  /** ROK-1948 D1: the pruned graph every response is built from. */
  private async visible(
    r: RecipesReader,
    set: ValheimRecipeSetRow,
  ): Promise<VisibleRecipes> {
    const full = await this.graph(r, set);
    return visibleRecipes(this.visibleGraphs, r, set, full);
  }

  /** D5: keyed on `imported_at`, which every re-import bumps. */
  private graph(r: RecipesReader, set: ValheimRecipeSetRow) {
    return this.graphs.getOrLoad(
      set.id,
      set.importedAt.getTime(),
      async () => ({
        ...toRecipeGraphRows(await r.loadRows(set.id)),
        gameVersion: set.gameVersion,
      }),
    );
  }
}
