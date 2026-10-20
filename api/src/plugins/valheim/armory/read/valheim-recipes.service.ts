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
  ValheimRecipePlanResponseSchema,
  ValheimRecipeTreeResponseSchema,
  type ValheimRecipeCatalogResponse,
  type ValheimRecipePlanResponse,
  type ValheimRecipePlanTarget,
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
  catalogueStations,
  maxQualityLookup,
  producedPrefabs,
  reachablePrefabs,
} from './valheim-recipes.catalog.helpers';
import { RecipeGraphCache, type RecipeGraph } from './valheim-recipes.graph';
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
import {
  resolvePlan,
  resolveTree,
  type ResolveResult,
} from './valheim-recipes.resolve';

@Injectable()
export class ValheimRecipesService {
  /** D5: one LRU per API process (the service is a Nest singleton). */
  private readonly graphs = new RecipeGraphCache();

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
      const set = await r.latestSet(serverId);
      if (!set) return emptyCatalogue();
      const graph = await this.graph(r, set);
      const prefabs = producedPrefabs(graph);
      const cat = await r.materials.findCatalog(
        serverId,
        set.gameVersion,
        prefabs,
      );
      return {
        gameVersion: set.gameVersion,
        capturedAt: toMinuteIso(set.capturedAt),
        catalogFallback: cat !== null && !cat.exact,
        entries: catalogueEntries(graph, cat?.items ?? null),
        stations: catalogueStations(graph),
        itemAtlas: projectCatalog([], cat).atlas,
        recipeAtlas: await r.recipeAtlas(set),
      };
    });
    return ValheimRecipeCatalogResponseSchema.parse(body);
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
    const body = await this.repo.read(async (r) => {
      const set = await r.latestSet(serverId);
      const graph = set ? await this.graph(r, set) : null;
      if (!set || !graph || !hasTreeTarget(graph, prefab, kind)) {
        throw new NotFoundException(RECIPE_NOT_FOUND);
      }
      const { cat, maxQ } = await this.catalogFor(r, set, graph, [prefab]);
      const q = kind === 'piece' ? 1 : Math.min(quality, maxQ(prefab));
      const target = { prefab, quality: q, amount: 1, fromQuality: 0 };
      const res = resolveTree(
        graph,
        kind ? { ...target, kind } : target,
        null,
        { maxQuality: maxQ },
      );
      return {
        target: { prefab, quality: q },
        ...pickTree(res),
        ...nodeCatalog(res, cat),
        recipeAtlas: await r.recipeAtlas(set),
      };
    });
    return ValheimRecipeTreeResponseSchema.parse(body);
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
      const set = await r.latestSet(serverId);
      return set ? this.planIn(r, set, targets, scope) : emptyPlan(targets);
    });
    return ValheimRecipePlanResponseSchema.parse(body);
  }

  private async planIn(
    r: RecipesReader,
    set: ValheimRecipeSetRow,
    targets: ValheimRecipePlanTarget[],
    scope: SQL,
  ): Promise<ValheimRecipePlanResponse> {
    const graph = await this.graph(r, set);
    const { scan, stock } = await loadStock(r, set.pelicanServerId, scope);
    const ids = targets.map((t) => t.prefab);
    const { cat, maxQ } = await this.catalogFor(r, set, graph, ids);
    const planned = clampTargets(targets, maxQ);
    const res = resolvePlan(graph, planned, stock, { maxQuality: maxQ });
    const { items, itemAtlas } = nodeCatalog(res, cat);
    return {
      targets: planned,
      ...pickTree(res),
      stock: scan ? 'scan' : 'none',
      capturedAt: scan ? toMinuteIso(scan.capturedAt) : null,
      shoppingList: res.shoppingList,
      fuelEstimates: res.fuelEstimates,
      items,
      itemAtlas,
      recipeAtlas: await r.recipeAtlas(set),
    };
  }

  /** D5: keyed on `imported_at`, which every re-import bumps. */
  private graph(r: RecipesReader, set: ValheimRecipeSetRow) {
    return this.graphs.getOrLoad(set.id, set.importedAt.getTime(), async () =>
      toRecipeGraphRows(await r.loadRows(set.id)),
    );
  }

  /**
   * ONE items-catalogue read (D6 choice) for everything reachable from
   * `roots`: the targets' `maxQuality` and, after resolving, the nodes'
   * names + icons.
   */
  private async catalogFor(
    r: RecipesReader,
    set: ValheimRecipeSetRow,
    graph: RecipeGraph,
    roots: string[],
  ) {
    const cat = await r.materials.findCatalog(
      set.pelicanServerId,
      set.gameVersion,
      reachablePrefabs(graph, roots),
    );
    return { cat, maxQ: maxQualityLookup(graph, cat?.items ?? null) };
  }
}

/** Catalogue subset for every prefab the resolved nodes reference. */
function nodeCatalog(
  res: ResolveResult,
  cat: Parameters<typeof projectCatalog>[1],
) {
  const prefabs = [...new Set(res.nodes.map((n) => n.prefab))].sort();
  const { items, atlas } = projectCatalog(prefabs, cat);
  return { items, itemAtlas: atlas };
}

function pickTree(res: ResolveResult) {
  return { nodes: res.nodes, truncated: res.truncated };
}
