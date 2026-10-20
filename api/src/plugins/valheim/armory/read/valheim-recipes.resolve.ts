/**
 * ROK-1854 §2.4 — tree / plan resolver over one `RecipeGraph`. Depth-first;
 * every item first takes `min(stock, need)` from the ledger (plan only),
 * the rest comes from the D9 source. Flat `ValheimPlanNode` list, ids =
 * list index, `parentId` links. Pure: no Nest, no DB.
 */
import {
  VALHEIM_PLAN_NODES_MAX,
  type ValheimPiece,
  type ValheimRecipe,
} from '@raid-ledger/contract';
import type { RecipeGraph } from './valheim-recipes.graph';
import {
  PlanBuilder,
  pickSource,
  pieceVia,
  processVia,
  recipeVia,
  type ProcessSource,
  recipeSteps,
  type InputLine,
  type NodeBase,
  type ResolveOptions,
  type ResolveResult,
  type ResolveTarget,
  type Taken,
} from './valheim-recipes.resolve.helpers';

export type { ResolveOptions, ResolveResult, ResolveTarget };

/** Walk depth cap (§2.4). */
export const RECIPE_TREE_DEPTH_MAX = 16;

interface Ctx {
  graph: RecipeGraph;
  b: PlanBuilder;
  maxDepth: number;
}

interface Need {
  prefab: string;
  quantity: number;
  parentId: number | null;
  depth: number;
  /** Prefabs on the path from the root to this node's parent. */
  path: ReadonlySet<string>;
  startStep: number;
  quality: number;
  /** False for an upgrade / quality > 1 target: stock has no quality. */
  net: boolean;
  /** anyOneOf: the other ingredients that could stand in. */
  alternatives?: number;
}

function nodeBase(need: Need, taken: Taken): NodeBase {
  return {
    prefab: need.prefab,
    quantity: need.quantity,
    parentId: need.parentId,
    have: taken.have,
    short: taken.short,
  };
}

/** Depth and node caps; flags `truncated`. */
function canPlace(ctx: Ctx, depth: number): boolean {
  if (depth <= ctx.maxDepth) return ctx.b.hasRoom();
  ctx.b.truncated = true;
  return false;
}

function child(
  need: Need,
  parentId: number,
  prefab: string,
  quantity: number,
  alternatives?: number,
): Need {
  const base: Need = {
    prefab,
    quantity,
    parentId,
    depth: need.depth + 1,
    path: new Set([...need.path, need.prefab]),
    startStep: 1,
    quality: 1,
    net: true,
  };
  return alternatives === undefined ? base : { ...base, alternatives };
}

function expandChildren(
  ctx: Ctx,
  need: Need,
  id: number,
  anyOneOf: boolean,
  list: InputLine[],
): void {
  if (!anyOneOf) {
    for (const c of list) expandItem(ctx, child(need, id, c.prefab, c.amount));
    return;
  }
  // anyOneOf: the first alternative the ledger covers, else the first.
  const pick = list.find((v) => ctx.b.peek(v.prefab) >= v.amount) ?? list[0];
  if (pick) {
    expandItem(ctx, child(need, id, pick.prefab, pick.amount, list.length - 1));
  }
}

function expandItem(ctx: Ctx, need: Need): void {
  if (!canPlace(ctx, need.depth)) return;
  const taken = ctx.b.takeFor(need.prefab, need.quantity, need.net);
  const leaf = { ...nodeBase(need, taken), crafts: 0 };
  if (need.path.has(need.prefab)) {
    ctx.b.push({ ...leaf, via: { type: 'cycle' }, alternatives: 0 });
    return;
  }
  const pick = pickSource(ctx.graph, need.prefab, need.startStep, need.quality);
  const alternatives = need.alternatives ?? pick.alternatives;
  if (!pick.source) {
    ctx.b.push({ ...leaf, via: { type: 'gathered' }, alternatives });
  } else if (pick.source.type === 'recipe') {
    expandRecipe(ctx, need, taken, pick.source.recipe, alternatives);
  } else {
    expandProcess(ctx, need, taken, pick.source, alternatives);
  }
}

function expandRecipe(
  ctx: Ctx,
  need: Need,
  taken: Taken,
  recipe: ValheimRecipe,
  alternatives: number,
): void {
  const steps = recipeSteps(recipe, need.startStep, need.quality, taken.rest);
  const via = recipeVia(ctx.graph, recipe, need.quality);
  const id = ctx.b.push({
    ...nodeBase(need, taken),
    via,
    alternatives,
    crafts: steps.crafts,
  });
  expandChildren(ctx, need, id, recipe.anyOneOf, steps.totals);
}

function expandProcess(
  ctx: Ctx,
  need: Need,
  taken: Taken,
  src: ProcessSource,
  alternatives: number,
): void {
  const { process, processor } = src;
  const runs = Math.ceil(taken.rest / process.output.amount);
  const via = processVia(process, processor);
  const id = ctx.b.push({
    ...nodeBase(need, taken),
    via,
    alternatives,
    crafts: runs,
  });
  if (runs === 0) return;
  const inputs = process.inputs.map((i) => ({
    prefab: i.prefab,
    amount: i.amount * runs,
  }));
  expandChildren(ctx, need, id, process.anyOneOf, inputs);
  addFuel(ctx, need, id, src, runs);
}

/** Smelter fuel → a `fuel` child; cooking fuel → `fuelEstimates` only. */
function addFuel(
  ctx: Ctx,
  need: Need,
  id: number,
  src: ProcessSource,
  runs: number,
): void {
  const { process, processor } = src;
  if (processor.fuel === null) return;
  const perProduct = processor.fuelPerProduct ?? 0;
  if (processor.type === 'smelter' && perProduct > 0) {
    expandFuel(ctx, child(need, id, processor.fuel, perProduct * runs));
  } else if (processor.type === 'cooking' && process.seconds !== null) {
    ctx.b.addFuelEstimate(
      processor.fuel,
      processor.prefab,
      process.seconds * runs,
    );
  }
}

/** A `fuel` node; a producible fuel (Coal via kiln) gets its source as one child. */
function expandFuel(ctx: Ctx, need: Need): void {
  if (!canPlace(ctx, need.depth)) return;
  const taken = ctx.b.takeFor(need.prefab, need.quantity, need.net);
  const id = ctx.b.push({
    ...nodeBase(need, taken),
    via: { type: 'fuel' },
    alternatives: 0,
    crafts: 0,
  });
  if (taken.rest === 0 || need.path.has(need.prefab)) return;
  if (!pickSource(ctx.graph, need.prefab, 1, 1).source) return;
  expandItem(ctx, {
    ...child(need, id, need.prefab, taken.rest),
    path: need.path,
  });
}

/** Pieces have no quality and no recipe id: the piece prefab stands in. */
function expandPiece(ctx: Ctx, need: Need, piece: ValheimPiece): void {
  const taken = ctx.b.takeFor(need.prefab, need.quantity, need.net);
  const id = ctx.b.push({
    ...nodeBase(need, taken),
    via: pieceVia(piece),
    alternatives: 0,
    crafts: taken.rest,
  });
  const totals = piece.resources
    .filter((r) => r.amount > 0)
    .map((r) => ({ prefab: r.prefab, amount: r.amount * taken.rest }));
  if (taken.rest > 0) expandChildren(ctx, need, id, false, totals);
}

function expandTarget(
  ctx: Ctx,
  target: ResolveTarget,
  maxQuality: (prefab: string) => number,
): void {
  const piece = ctx.graph.pieces.get(target.prefab);
  const kind =
    target.kind ??
    (piece && !ctx.graph.recipesByResult.has(target.prefab) ? 'piece' : 'item');
  const quality =
    kind === 'piece'
      ? 1
      : Math.max(1, Math.min(target.quality, maxQuality(target.prefab)));
  const need: Need = {
    prefab: target.prefab,
    quantity: target.amount,
    parentId: null,
    depth: 0,
    path: new Set(),
    startStep: target.fromQuality >= 1 ? target.fromQuality + 1 : 1,
    quality,
    net: quality === 1 && target.fromQuality === 0,
  };
  if (kind === 'piece' && piece) {
    if (canPlace(ctx, 0)) expandPiece(ctx, need, piece);
  } else {
    expandItem(ctx, need);
  }
}

/** Targets in request order against ONE ledger (A3). `stock` null = no netting. */
export function resolvePlan(
  graph: RecipeGraph,
  targets: readonly ResolveTarget[],
  stock: ReadonlyMap<string, number> | null,
  options: ResolveOptions = {},
): ResolveResult {
  const b = new PlanBuilder(
    stock ? new Map(stock) : null,
    options.maxNodes ?? VALHEIM_PLAN_NODES_MAX,
  );
  const ctx: Ctx = {
    graph,
    b,
    maxDepth: options.maxDepth ?? RECIPE_TREE_DEPTH_MAX,
  };
  const maxQuality = options.maxQuality ?? (() => 1);
  for (const target of targets) expandTarget(ctx, target, maxQuality);
  return {
    nodes: b.nodes,
    truncated: b.truncated,
    shoppingList: b.shoppingList(),
    fuelEstimates: b.fuelEstimates,
  };
}

/** One target; `/tree` passes `stock` null. */
export function resolveTree(
  graph: RecipeGraph,
  target: ResolveTarget,
  stock: ReadonlyMap<string, number> | null,
  options: ResolveOptions = {},
): ResolveResult {
  return resolvePlan(graph, [target], stock, options);
}
