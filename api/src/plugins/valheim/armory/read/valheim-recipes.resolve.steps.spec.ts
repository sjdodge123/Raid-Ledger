import {
  ValheimPlanViaSchema,
  type ValheimPlanNode,
  type ValheimPlanStep,
} from '@raid-ledger/contract';
import { buildRecipeGraph } from './valheim-recipes.graph';
import {
  resolvePlan,
  resolveTree,
  type ResolveTarget,
} from './valheim-recipes.resolve';
import {
  UPGRADER_TEST_STATION,
  upgraderRecipeRows,
} from './valheim-recipes.upgrader.testing';

/** ROK-1861 — per-quality steps on recipe nodes + upgrader station builds. */
const graph = buildRecipeGraph(upgraderRecipeRows());
const q4 = { maxQuality: () => 4 };
const CHEST = 'ArmorBronzeChest';

function target(
  prefab: string,
  quality: number,
  over: Partial<ResolveTarget> = {},
): ResolveTarget {
  return { prefab, quality, amount: 1, fromQuality: 0, ...over };
}

function must<T>(v: T | undefined, label: string): T {
  if (v === undefined) throw new Error(`missing ${label}`);
  return v;
}

function rootOf(nodes: ValheimPlanNode[], prefab: string): ValheimPlanNode {
  return must(
    nodes.find((n) => n.parentId === null && n.prefab === prefab),
    `${prefab} root`,
  );
}

function stepsOf(node: ValheimPlanNode): ValheimPlanStep[] | undefined {
  return node.via.type === 'recipe' ? node.via.steps : undefined;
}

/** prefab → amount of one step's resources. */
function costOf(step: ValheimPlanStep | undefined): Record<string, number> {
  return Object.fromEntries(
    (step?.resources ?? []).map((r) => [r.prefab, r.amount]),
  );
}

describe('planSteps — a q3 craft at an upgrade station (AC 1)', () => {
  const tree = resolveTree(graph, target(CHEST, 3), null, q4);
  const root = rootOf(tree.nodes, CHEST);

  it('lists one step per quality at the upgrader, levels 1/2/3', () => {
    expect(
      stepsOf(root)?.map((s) => [s.quality, s.station, s.stationLevel]),
    ).toEqual([
      [1, UPGRADER_TEST_STATION, 1],
      [2, UPGRADER_TEST_STATION, 2],
      [3, UPGRADER_TEST_STATION, 3],
    ]);
    expect(stepsOf(root)?.map((s) => s.upgraderStation)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('is a valid contract via', () => {
    expect(ValheimPlanViaSchema.safeParse(root.via).success).toBe(true);
  });

  it('charges the upgrade item on q2 and q3 only (AC 2)', () => {
    const steps = stepsOf(root) ?? [];
    expect(steps.map((s) => costOf(s).Upgrader1Armor ?? 0)).toEqual([0, 1, 1]);
    const idol = tree.nodes.find(
      (n) => n.parentId === root.id && n.prefab === 'Upgrader1Armor',
    );
    expect(idol?.quantity).toBe(2);
  });

  it('Σ step resources == the node children (D3 invariant)', () => {
    const sums: Record<string, number> = {};
    for (const s of stepsOf(root) ?? []) {
      for (const r of s.resources)
        sums[r.prefab] = (sums[r.prefab] ?? 0) + r.amount;
    }
    const children = Object.fromEntries(
      tree.nodes
        .filter((n) => n.parentId === root.id)
        .map((n) => [n.prefab, n.quantity]),
    );
    expect(sums).toEqual(children);
    expect(sums).toEqual({ Bronze: 5 + 3 + 6, DeerHide: 2, Upgrader1Armor: 2 });
  });
});

describe('planSteps — when steps are emitted (D2)', () => {
  it('a q1 craft and a single upgrade step carry no steps key', () => {
    const q1 = rootOf(
      resolveTree(graph, target(CHEST, 1), null, q4).nodes,
      CHEST,
    );
    const up = resolveTree(
      graph,
      target(CHEST, 3, { fromQuality: 2 }),
      null,
      q4,
    );
    expect(q1.via).not.toHaveProperty('steps');
    expect(rootOf(up.nodes, CHEST).via).not.toHaveProperty('steps');
  });

  it('a q1 ingredient under a stepped node carries no steps key', () => {
    const tree = resolveTree(graph, target(CHEST, 3), null, q4);
    const bronze = must(
      tree.nodes.find((n) => n.prefab === 'Bronze' && n.parentId !== null),
      'Bronze child',
    );
    expect(bronze.via).not.toHaveProperty('steps');
  });

  it('multiplies each step by the crafts for amount 3 (q1 ×3, q2 ×3)', () => {
    const tree = resolveTree(graph, target(CHEST, 2, { amount: 3 }), null, q4);
    const steps = stepsOf(rootOf(tree.nodes, CHEST));
    expect(costOf(steps?.[0])).toEqual({ Bronze: 15, DeerHide: 6 });
    expect(costOf(steps?.[1])).toEqual({ Bronze: 9, Upgrader1Armor: 3 });
  });

  it('a q3 craft at a plain station has steps flagged false and no build', () => {
    const tree = resolveTree(graph, target('SwordBronze', 3), null, q4);
    const steps = stepsOf(rootOf(tree.nodes, 'SwordBronze'));
    expect(steps?.map((s) => [s.station, s.upgraderStation])).toEqual([
      ['forge', false],
      ['forge', false],
      ['forge', false],
    ]);
    expect([...tree.stationBuilds.keys()]).toEqual([]);
  });
});

describe('stationBuilds — the upgrader piece cost (D5)', () => {
  it('carries the upgrader station build once, never as a node', () => {
    const tree = resolveTree(graph, target(CHEST, 3), null, q4);
    expect(tree.stationBuilds?.get(UPGRADER_TEST_STATION)).toEqual([
      { prefab: 'Stone', amount: 10 },
      { prefab: 'Bronze', amount: 2 },
    ]);
    expect(tree.nodes.some((n) => n.prefab === 'Stone')).toBe(false);
  });

  it('leaves the shopping list without the build lines', () => {
    const plan = resolvePlan(graph, [target(CHEST, 3)], new Map(), q4);
    expect(
      Object.fromEntries(plan.shoppingList.map((l) => [l.prefab, l.need])),
    ).toEqual({ Copper: 28, Tin: 14, DeerHide: 2, Upgrader1Armor: 2 });
  });

  it('a single-step node names no build (only stepped nodes do)', () => {
    const tree = resolveTree(graph, target(CHEST, 1), null, q4);
    expect([...(tree.stationBuilds?.keys() ?? [])]).toEqual([]);
  });
});
