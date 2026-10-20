/**
 * ROK-1854 L3 — the pure pieces of the resolver: the §1.2 per-quality
 * formula, D9 source choice, and the node builder that owns the stock
 * ledger, the node cap and the leaf roll-ups.
 */
import type {
  ValheimPiece,
  ValheimPlanNode,
  ValheimPlanVia,
  ValheimProcess,
  ValheimProcessor,
  ValheimProcessorType,
  ValheimRecipe,
  ValheimRecipePlanResponse,
  ValheimRecipePlanTarget,
  ValheimRecipeResource,
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

export interface ResolveTarget extends ValheimRecipePlanTarget {
  /** Omitted → `piece` when only a piece builds the prefab, else `item`. */
  kind?: 'item' | 'piece';
}

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
  for (let q = startStep; q <= quality && rest > 0; q += 1) {
    const stepCrafts = q === 1 ? Math.ceil(rest / recipe.amount) : rest;
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
  return { crafts, totals };
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

  /** What the ledger still holds of `prefab` (0 without stock). */
  peek(prefab: string): number {
    return this.ledger?.get(prefab) ?? 0;
  }

  /** Takes `min(stock, need)` from the ledger; null without stock. */
  take(prefab: string, need: number): number | null {
    if (!this.ledger) return null;
    const left = this.ledger.get(prefab) ?? 0;
    const have = Math.min(left, need);
    this.ledger.set(prefab, left - have);
    return have;
  }

  /** `net` false (upgrade / quality > 1 target): nothing taken, have 0. */
  takeFor(prefab: string, need: number, net: boolean): Taken {
    const have = net ? this.take(prefab, need) : this.ledger ? 0 : null;
    const rest = need - (have ?? 0);
    return { have, rest, short: have === null ? null : rest };
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

  /** Σ over gathered / cycle / fuel LEAVES, first-seen order. */
  shoppingList(): ShoppingLine[] {
    const lines = new Map<string, ShoppingLine>();
    for (const n of this.nodes) {
      if (this.parents.has(n.id) || !isLeafVia(n)) continue;
      const line = lines.get(n.prefab) ?? {
        prefab: n.prefab,
        need: 0,
        have: this.hasStock ? 0 : null,
        short: this.hasStock ? 0 : null,
      };
      line.need += n.quantity;
      if (line.have !== null) line.have += n.have ?? 0;
      if (line.short !== null) line.short += n.short ?? 0;
      lines.set(n.prefab, line);
    }
    return [...lines.values()];
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
