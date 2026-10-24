/**
 * ROK-1948 R6 — on a spoiler-pruned graph (`withheld` set), a recipe step
 * whose per-quality station is no longer in the graph makes the node an
 * `undiscovered` leaf. The full graph (no `withheld`) is never affected.
 */
import type { ValheimPlanNode } from '@raid-ledger/contract';
import { RECIPES_DEMO_MESSAGE as DEMO } from '../valheim-armory-recipes-demo-fixture';
import { buildRecipeGraph, type RecipeGraph } from './valheim-recipes.graph';
import { resolveTree, type ResolveTarget } from './valheim-recipes.resolve';

// Hand-made at q1, upgraded at the Forge from q2 (`repairStation`).
const [base] = DEMO.recipes;
if (!base) throw new Error('demo set has no recipe');
const full = buildRecipeGraph({
  recipes: [
    {
      ...base,
      id: 'Recipe_AxeX',
      result: 'AxeX',
      station: null,
      repairStation: 'forge',
      resources: [
        {
          prefab: 'Iron',
          amount: 4,
          amountPerLevel: 2,
          extraAmountOnlyOneIngredient: 0,
          recover: true,
        },
      ],
    },
  ],
  pieces: [],
  stations: [],
  processors: [],
  processes: [],
});
const pruned: RecipeGraph = { ...full, withheld: new Set<string>() };
const opts = { maxQuality: () => 3 };

function plan(g: RecipeGraph, over: Partial<ResolveTarget>): ValheimPlanNode[] {
  const target = { prefab: 'AxeX', quality: 1, amount: 1, fromQuality: 0 };
  return resolveTree(g, { ...target, ...over }, null, opts).nodes;
}

function root(g: RecipeGraph, over: Partial<ResolveTarget>): ValheimPlanNode {
  const [node] = plan(g, over);
  if (!node) throw new Error('no root node');
  return node;
}

describe('resolveTree — ROK-1948 R6 (per-quality station hidden)', () => {
  it('a step at an unfound station makes the root an undiscovered leaf', () => {
    expect(plan(pruned, { quality: 2 })).toHaveLength(1);
    expect(root(pruned, { quality: 2 })).toMatchObject({
      prefab: 'AxeX',
      via: { type: 'undiscovered' },
      crafts: 0,
      alternatives: 0,
    });
    expect(root(pruned, { quality: 2, fromQuality: 1 }).via.type).toBe(
      'undiscovered',
    );
  });

  it('q1 by hand still resolves; the full graph is untouched', () => {
    expect(root(pruned, { quality: 1 }).via.type).toBe('recipe');
    expect(root(full, { quality: 2 }).via.type).toBe('recipe');
    expect(plan(full, { quality: 2 }).map((n) => n.prefab)).toEqual([
      'AxeX',
      'Iron',
    ]);
  });
});
