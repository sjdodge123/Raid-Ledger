/**
 * ROK-1854 §2.4 — tree / plan resolver over one `RecipeGraph`. Depth-first;
 * every item first takes `min(stock, need)` from the ledger (plan only),
 * the rest comes from the D9 source. Flat `ValheimPlanNode` list, ids =
 * list index, `parentId` links. Pure: no Nest, no DB.
 */
import {
  VALHEIM_PLAN_NODES_MAX,
  VALHEIM_PLAN_QUANTITY_MAX,
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
  child,
  type InputLine,
  type Need,
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

/**
 * A need above VALHEIM_PLAN_QUANTITY_MAX is clamped to it and becomes a leaf
 * (`expand` false); the builder flags `truncated`.
 */
function bound(ctx: Ctx, need: Need): { need: Need; expand: boolean } {
  if (need.quantity <= VALHEIM_PLAN_QUANTITY_MAX) return { need, expand: true };
  return {
    need: { ...need, quantity: ctx.b.cap(need.quantity) },
    expand: false,
  };
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

function expandItem(ctx: Ctx, raw: Need): void {
  if (!canPlace(ctx, raw.depth)) return;
  const { need, expand } = bound(ctx, raw);
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
    const recipe = pick.source.recipe;
    expandRecipe(ctx, { need, taken, alternatives, expand }, recipe);
  } else {
    expandProcess(ctx, { need, taken, alternatives, expand }, pick.source);
  }
}

/** One placed node's walk state. */
interface Step {
  need: Need;
  taken: Taken;
  alternatives: number;
  /** False once the quantity was clamped: the node is a leaf. */
  expand: boolean;
}

function expandRecipe(ctx: Ctx, step: Step, recipe: ValheimRecipe): void {
  const { need, taken, alternatives } = step;
  const steps = recipeSteps(recipe, need.startStep, need.quality, taken.rest);
  const via = recipeVia(ctx.graph, recipe, need.quality);
  const id = ctx.b.push({
    ...nodeBase(need, taken),
    via,
    alternatives,
    crafts: ctx.b.cap(steps.crafts),
  });
  if (step.expand) expandChildren(ctx, need, id, recipe.anyOneOf, steps.totals);
}

function expandProcess(ctx: Ctx, step: Step, src: ProcessSource): void {
  const { need, taken, alternatives } = step;
  const { process, processor } = src;
  const runs = Math.ceil(taken.rest / process.output.amount);
  const via = processVia(process, processor);
  const id = ctx.b.push({
    ...nodeBase(need, taken),
    via,
    alternatives,
    crafts: ctx.b.cap(runs),
  });
  if (runs === 0 || !step.expand) return;
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
function expandFuel(ctx: Ctx, raw: Need): void {
  if (!canPlace(ctx, raw.depth)) return;
  const { need, expand } = bound(ctx, raw);
  const taken = ctx.b.takeFor(need.prefab, need.quantity, need.net);
  const id = ctx.b.push({
    ...nodeBase(need, taken),
    via: { type: 'fuel' },
    alternatives: 0,
    crafts: 0,
  });
  if (!expand || taken.rest === 0 || need.path.has(need.prefab)) return;
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
