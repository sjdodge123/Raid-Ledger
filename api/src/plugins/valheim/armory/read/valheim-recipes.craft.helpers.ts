/**
 * ROK-1899 §2.2 — the crafting window's per-entry costs, computed from the
 * recipe graph with the resolver's own pieces (D9 `pickSource`, §1.2
 * `stationAt` / `stationLevelAt`, the set's cost rule via `recipeSteps`) so
 * a catalogue step always equals the plan's cost for the same step. Pure.
 */
import type {
  ValheimPiece,
  ValheimRecipeCraft,
  ValheimRecipeUpgrade,
} from '@raid-ledger/contract';
import type { RecipeGraph } from './valheim-recipes.graph';
import {
  pickSource,
  recipeSteps,
  stationAt,
  stationLevelAt,
  type InputLine,
} from './valheim-recipes.resolve.helpers';

/** Highest quality the contract carries (`ValheimRecipeUpgradeSchema.quality`). */
const QUALITY_MAX = 10;

/** Fresh `{prefab, amount}` lines with zero amounts dropped (the cost schema needs ≥1). */
function positive(lines: readonly InputLine[]): InputLine[] {
  return lines
    .filter((l) => l.amount >= 1)
    .map(({ prefab, amount }) => ({ prefab, amount }));
}

/** A build piece: its station at level 1 (0 when built anywhere), one per build. */
function pieceCraft(piece: ValheimPiece): ValheimRecipeCraft {
  return {
    via: 'piece',
    station: piece.station,
    stationLevel: piece.station === null ? 0 : 1,
    anyOneOf: false,
    resources: positive(piece.resources),
    amount: 1,
  };
}

/**
 * The CRAFT tab (quality 1). An item takes the D9 source at step 1: the first
 * enabled non-upgrade-only recipe, else the first auto process (station = the
 * processor, level 0); null when nothing makes it. A piece is always `piece`.
 */
export function craftOf(
  graph: RecipeGraph,
  target: string | ValheimPiece,
): ValheimRecipeCraft | null {
  if (typeof target !== 'string') return pieceCraft(target);
  const source = pickSource(graph, target, 1, 1).source;
  if (!source) return null;
  if (source.type === 'process') {
    const { process } = source;
    return {
      via: 'process',
      station: source.processor.prefab,
      stationLevel: 0,
      anyOneOf: process.anyOneOf,
      resources: positive(process.inputs),
      amount: process.output.amount,
    };
  }
  const r = source.recipe;
  return {
    via: 'recipe',
    station: stationAt(r, 1),
    stationLevel: stationLevelAt(r, 1),
    anyOneOf: r.anyOneOf,
    resources: positive(recipeSteps(r, 1, 1, r.amount, graph.costRule).totals),
    amount: r.amount,
  };
}

/**
 * One upgrade step `q − 1 → q`; null when no recipe is valid at step `q`,
 * `'hidden'` when the only valid ones need a station nobody has found.
 */
function upgradeAt(
  graph: RecipeGraph,
  prefab: string,
  q: number,
): ValheimRecipeUpgrade | 'hidden' | null {
  const { source, hidden } = pickSource(graph, prefab, q, q);
  if (source?.type !== 'recipe') return hidden ? 'hidden' : null;
  const r = source.recipe;
  const station = stationAt(r, q);
  return {
    quality: q,
    station,
    stationLevel: stationLevelAt(r, q),
    anyOneOf: r.anyOneOf,
    resources: positive(recipeSteps(r, q, q, 1, graph.costRule).totals),
    upgraderStation:
      station !== null && (graph.stations.get(station)?.upgrader ?? false),
  };
}

/**
 * The UPGRADE tab: for q in 2..maxQuality, the D9 recipe valid at
 * `startStep = q` (upgrade-only included) and that one step's cost — what
 * `/plan` charges for `fromQuality = q − 1, quality = q`.
 */
export function upgradesOf(
  graph: RecipeGraph,
  prefab: string,
  maxQuality: number,
): ValheimRecipeUpgrade[] {
  const out: ValheimRecipeUpgrade[] = [];
  for (let q = 2; q <= Math.min(maxQuality, QUALITY_MAX); q += 1) {
    const step = upgradeAt(graph, prefab, q);
    // ROK-1948 R6: stop at the first step whose every route needs a station nobody has found.
    if (step === 'hidden') break;
    if (step) out.push(step);
  }
  return out;
}

/** Every prefab one source of `prefab` consumes directly (no fuel, no recursion). */
function inputsOf(graph: RecipeGraph, prefab: string): string[] {
  const out: string[] = [];
  for (const r of graph.recipesByResult.get(prefab) ?? []) {
    for (const res of r.resources) out.push(res.prefab);
  }
  for (const p of graph.processesByOutput.get(prefab) ?? []) {
    for (const i of p.inputs) out.push(i.prefab);
  }
  for (const res of graph.pieces.get(prefab)?.resources ?? []) {
    out.push(res.prefab);
  }
  return out;
}

/**
 * Sorted union of the direct inputs of every recipe, process and piece that
 * makes one of `prefabs` — a superset of every `craft`/`upgrades` resource,
 * so the catalogue's ONE items read can also name the ingredients.
 */
export function directInputs(
  graph: RecipeGraph,
  prefabs: readonly string[],
): string[] {
  const set = new Set<string>();
  for (const p of prefabs) for (const i of inputsOf(graph, p)) set.add(i);
  return [...set].sort();
}
