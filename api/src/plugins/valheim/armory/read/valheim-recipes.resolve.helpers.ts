/**
 * ROK-1854 L3 — the pure pieces of the resolver: the §1.2 per-quality
 * formula, D9 source choice, and the node builder that owns the stock
 * ledger, the node cap and the leaf roll-ups.
 */
import {
  VALHEIM_PLAN_QUANTITY_MAX,
  type ValheimPiece,
  type ValheimPlanNode,
  type ValheimPlanVia,
  type ValheimProcess,
  type ValheimProcessor,
  type ValheimProcessorType,
  type ValheimRecipe,
  type ValheimRecipePlanResponse,
  type ValheimRecipePlanTarget,
  type ValheimRecipeResource,
} from '@raid-ledger/contract';
import type { RecipeGraph } from './valheim-recipes.graph';

export type ShoppingLine = ValheimRecipePlanResponse['shoppingList'][number];
export type FuelEstimate = ValheimRecipePlanResponse['fuelEstimates'][number];

/** §1.2 `amount(r, q)`. */
export function amountAt(r: ValheimRecipeResource, q: number): number {
  return q <= 1 ? r.amount : (q - 1) * r.amountPerLevel;
}

/** §1.2 `stationLevel(R, q)`. */
export function stationLevelAt(recipe: ValheimRecipe, q: number): number {
  return Math.max(1, recipe.minStationLevel) + (q - 1);
}

/** §1.2 `station(R, q)`. */
export function stationAt(recipe: ValheimRecipe, q: number): string | null {
  return recipe.station ?? (q > 1 ? recipe.repairStation : null);
}

/** `kind` omitted → `piece` when no recipe or process makes the prefab but a piece builds it, else `item`. */
export type ResolveTarget = ValheimRecipePlanTarget;

export interface ResolveOptions {
  /** Items-catalogue `m_maxQuality`; the target quality is clamped to it. Default 1. */
  maxQuality?: (prefab: string) => number;
  maxNodes?: number;
  maxDepth?: number;
}

export interface ResolveResult {
  nodes: ValheimPlanNode[];
  truncated: boolean;
  shoppingList: ShoppingLine[];
  fuelEstimates: FuelEstimate[];
}

export interface Need {
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

export function child(
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

export type InputLine = { prefab: string; amount: number };

/** What the ledger gave one node. */
export interface Taken {
  have: number | null;
  rest: number;
  short: number | null;
}

export type NodeBase = Pick<
  ValheimPlanNode,
  'prefab' | 'quantity' | 'parentId' | 'have' | 'short'
>;

export interface RecipeSteps {
  crafts: number;
  /** Ingredient prefab → total amount, in resource order; zero amounts dropped. */
  totals: InputLine[];
  /** q = 1 batch overshoot: `crafts × recipe.amount − rest`. */
  surplus: number;
}

/** Σ over quality steps `startStep..quality`; 1 item per upgrade step. */
export function recipeSteps(
  recipe: ValheimRecipe,
  startStep: number,
  quality: number,
  rest: number,
): RecipeSteps {
  const sums = new Map<string, number>(
    recipe.resources.map((r) => [r.prefab, 0]),
  );
  let crafts = 0;
  let surplus = 0;
  for (let q = startStep; q <= quality && rest > 0; q += 1) {
    const stepCrafts = q === 1 ? Math.ceil(rest / recipe.amount) : rest;
    if (q === 1) surplus = stepCrafts * recipe.amount - rest;
    crafts += stepCrafts;
    for (const r of recipe.resources) {
      sums.set(
        r.prefab,
        (sums.get(r.prefab) ?? 0) + amountAt(r, q) * stepCrafts,
      );
    }
  }
  const totals = [...sums]
    .filter(([, n]) => n > 0)
    .map(([prefab, amount]) => ({ prefab, amount }));
  return { crafts, totals, surplus };
}

export interface ProcessSource {
  process: ValheimProcess;
  processor: ValheimProcessor;
}

export type PlanSource =
  | { type: 'recipe'; recipe: ValheimRecipe }
  | ({ type: 'process' } & ProcessSource);

/** D9: the obliterator (`incinerator`) is never auto-picked. */
const AUTO_PROCESSORS: ReadonlySet<ValheimProcessorType> = new Set([
  'smelter',
  'fermenter',
  'cooking',
]);

/** D9 rank: crafting recipe > upgrade-only recipe > process. */
export function sourceRank(s: PlanSource): number {
  if (s.type === 'process') return 2;
  return s.recipe.upgradeOnly ? 1 : 0;
}

function candidates(
  graph: RecipeGraph,
  prefab: string,
  startStep: number,
  quality: number,
): PlanSource[] {
  const out: PlanSource[] = (graph.recipesByResult.get(prefab) ?? [])
    .filter((r) => r.enabled && (!r.upgradeOnly || startStep >= 2))
    .map((recipe) => ({ type: 'recipe', recipe }));
  if (quality > 1) return out;
  for (const process of graph.processesByOutput.get(prefab) ?? []) {
    const processor = graph.processors.get(process.processor);
    if (processor && AUTO_PROCESSORS.has(processor.type))
      out.push({ type: 'process', process, processor });
  }
  return out;
}

export interface SourcePick {
  source: PlanSource | null;
  alternatives: number;
}

/** First source by D9 rank; ties keep the graph's `id` / processor-prefab order. */
export function pickSource(
  graph: RecipeGraph,
  prefab: string,
  startStep: number,
  quality: number,
): SourcePick {
  const list = candidates(graph, prefab, startStep, quality);
  const ranked = list
    .map((source, i) => ({ source, i }))
    .sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || a.i - b.i);
  return {
    source: ranked[0]?.source ?? null,
    alternatives: Math.max(0, list.length - 1),
  };
}

type NodeInput = Omit<ValheimPlanNode, 'id'>;

/** Owns the node list, the ledger (null = `/tree`, no netting) and the caps. */
export class PlanBuilder {
  readonly nodes: ValheimPlanNode[] = [];
  readonly fuelEstimates: FuelEstimate[] = [];
  truncated = false;
  private readonly parents = new Set<number>();
  /** Planned batch overshoot per prefab, reused by later needs (any branch). */
  private readonly surplus = new Map<string, number>();

  constructor(
    private readonly ledger: Map<string, number> | null,
    private readonly maxNodes: number,
  ) {}

  get hasStock(): boolean {
    return this.ledger !== null;
  }

  /** Room for one more node; flags `truncated` when there is none. */
  hasRoom(): boolean {
    if (this.nodes.length < this.maxNodes) return true;
    this.truncated = true;
    return false;
  }

  /** Clamps to VALHEIM_PLAN_QUANTITY_MAX; flags `truncated` when it bites. */
  cap(n: number): number {
    if (n <= VALHEIM_PLAN_QUANTITY_MAX) return n;
    this.truncated = true;
    return VALHEIM_PLAN_QUANTITY_MAX;
  }

  /** What the ledger still holds of `prefab` (0 without stock). */
  peek(prefab: string): number {
    return this.ledger?.get(prefab) ?? 0;
  }

  /** Records a planned craft's overshoot for later needs of `prefab`. */
  addSurplus(prefab: string, n: number): void {
    if (n > 0) this.surplus.set(prefab, (this.surplus.get(prefab) ?? 0) + n);
  }

  /**
   * Planned surplus first (never shown as `have`), then the chest ledger.
   * `have` = what the ledger holds of `prefab` BEFORE this take (the stock
   * available to this node); the ledger loses `min(have, left)`; `short` =
   * `max(0, need − surplus − have)`. `net` false (upgrade / quality > 1
   * target, piece): nothing taken, have 0. No ledger (`/tree`): have/short null.
   */
  takeFor(prefab: string, need: number, net: boolean): Taken {
    if (!net) {
      if (!this.ledger) return { have: null, rest: need, short: null };
      return { have: 0, rest: need, short: need };
    }
    const left = need - this.takeSurplus(prefab, need);
    if (!this.ledger) return { have: null, rest: left, short: null };
    const available = this.ledger.get(prefab) ?? 0;
    const used = Math.min(available, left);
    this.ledger.set(prefab, available - used);
    const rest = left - used;
    const have = Math.min(available, VALHEIM_PLAN_QUANTITY_MAX);
    return { have, rest, short: rest };
  }

  private takeSurplus(prefab: string, need: number): number {
    const held = this.surplus.get(prefab) ?? 0;
    const used = Math.min(held, need);
    if (used > 0) this.surplus.set(prefab, held - used);
    return used;
  }

  push(node: NodeInput): number {
    const id = this.nodes.length;
    this.nodes.push({ id, ...node });
    if (node.parentId !== null) this.parents.add(node.parentId);
    return id;
  }

  addFuelEstimate(prefab: string, processor: string, seconds: number): void {
    const hit = this.fuelEstimates.find(
      (f) => f.prefab === prefab && f.processor === processor,
    );
    if (hit) hit.seconds += seconds;
    else this.fuelEstimates.push({ prefab, processor, seconds });
  }

  /**
   * Σ over gathered / cycle / fuel LEAVES, first-seen order; when truncated,
   * also a crafted node whose children were all cut (else it would vanish
   * from the list). `have` = stock available at the prefab's first leaf;
   * `short` sums each leaf's shortfall (= max(0, need − have)).
   */
  shoppingList(): ShoppingLine[] {
    const lines = new Map<string, ShoppingLine>();
    for (const n of this.nodes) {
      if (this.parents.has(n.id) || !this.listsAsLeaf(n)) continue;
      const line = lines.get(n.prefab) ?? {
        prefab: n.prefab,
        need: 0,
        have: this.hasStock ? (n.have ?? 0) : null,
        short: this.hasStock ? 0 : null,
      };
      line.need = this.cap(line.need + n.quantity);
      if (line.short !== null)
        line.short = this.cap(line.short + (n.short ?? 0));
      lines.set(n.prefab, line);
    }
    return [...lines.values()];
  }

  private listsAsLeaf(n: ValheimPlanNode): boolean {
    return isLeafVia(n) || (this.truncated && n.crafts > 0);
  }
}

function isLeafVia(n: ValheimPlanNode): boolean {
  return (
    n.via.type === 'gathered' || n.via.type === 'cycle' || n.via.type === 'fuel'
  );
}

/** `via` of a recipe node at the target quality (§1.2 station + level). */
export function recipeVia(
  graph: RecipeGraph,
  recipe: ValheimRecipe,
  quality: number,
): ValheimPlanVia {
  const station = stationAt(recipe, quality);
  return {
    type: 'recipe',
    recipeId: recipe.id,
    station,
    stationLevel: stationLevelAt(recipe, quality),
    quality,
    upgradeOnly: recipe.upgradeOnly,
    formula: recipe.formula,
    anyOneOf: recipe.anyOneOf,
    upgraderStation:
      station === null
        ? false
        : (graph.stations.get(station)?.upgrader ?? false),
  };
}

export function processVia(
  process: ValheimProcess,
  processor: ValheimProcessor,
): ValheimPlanVia {
  return {
    type: 'process',
    processor: processor.prefab,
    processorType: processor.type,
    seconds: process.seconds,
    windPowered: processor.windPowered,
    fuel: processor.fuel,
  };
}

/** A piece node: the piece prefab stands in for the recipe id, quality 1. */
export function pieceVia(piece: ValheimPiece): ValheimPlanVia {
  return {
    type: 'recipe',
    recipeId: piece.prefab,
    station: piece.station,
    stationLevel: piece.station === null ? 0 : 1,
    quality: 1,
    upgradeOnly: false,
    formula: 'vanilla',
    anyOneOf: false,
    upgraderStation: false,
  };
}
