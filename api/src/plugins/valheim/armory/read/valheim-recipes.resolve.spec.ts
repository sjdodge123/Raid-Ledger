import {
  VALHEIM_PLAN_NODES_MAX,
  VALHEIM_PLAN_QUANTITY_MAX,
  ValheimRecipePlanResponseSchema,
  type ValheimPlanNode,
  type ValheimProcess,
  type ValheimProcessor,
  type ValheimProcessorType,
  type ValheimRecipe,
  type ValheimRecipeResource,
} from '@raid-ledger/contract';
import {
  buildRecipeGraph,
  type RecipeGraphRows,
} from './valheim-recipes.graph';
import {
  resolvePlan,
  resolveTree,
  type ResolveTarget,
} from './valheim-recipes.resolve';
import { emptyPlan } from './valheim-recipes.read.mappers';

const res = (
  prefab: string,
  amount: number,
  amountPerLevel = 0,
): ValheimRecipeResource => ({
  prefab,
  amount,
  amountPerLevel,
  extraAmountOnlyOneIngredient: 0,
  recover: true,
});

function recipe(
  id: string,
  result: string,
  resources: ValheimRecipeResource[],
  over: Partial<ValheimRecipe> = {},
): ValheimRecipe {
  return {
    id,
    result,
    amount: 1,
    enabled: true,
    station: 'forge',
    repairStation: 'forge',
    minStationLevel: 1,
    upgradeOnly: false,
    anyOneOf: false,
    qualityResultAmountMultiplier: 1,
    formula: 'vanilla',
    resources,
    ...over,
  };
}

function processor(
  prefab: string,
  type: ValheimProcessorType,
  fuel: string | null = null,
  fuelPerProduct: number | null = null,
): ValheimProcessor {
  return {
    prefab,
    type,
    fuel,
    fuelPerProduct,
    fuelSecondsPerUnit: null,
    windPowered: false,
    requiresRoof: false,
    maxInput: null,
    burntResult: null,
    defaultResult: null,
  };
}

function proc(
  processorPrefab: string,
  input: string,
  output: string,
  over: Partial<ValheimProcess> = {},
): ValheimProcess {
  return {
    processor: processorPrefab,
    inputs: [{ prefab: input, amount: 1 }],
    anyOneOf: false,
    output: { prefab: output, amount: 1 },
    seconds: 30,
    priority: 0,
    ...over,
  };
}

function graphOf(over: Partial<RecipeGraphRows>) {
  return buildRecipeGraph({
    recipes: [],
    pieces: [],
    stations: [],
    processors: [],
    processes: [],
    ...over,
  });
}

const item = (
  prefab: string,
  amount = 1,
  over: Partial<ResolveTarget> = {},
): ResolveTarget => ({
  prefab,
  quality: 1,
  amount,
  fromQuality: 0,
  ...over,
});

/** `id<parent prefab:via×quantity` — one line per node. */
function shape(nodes: ValheimPlanNode[]): string[] {
  return nodes.map(
    (n) =>
      `${n.id}<${n.parentId ?? '-'} ${n.prefab}:${n.via.type}×${n.quantity}`,
  );
}

function must<T>(v: T | undefined, label: string): T {
  if (v === undefined) throw new Error(`missing ${label}`);
  return v;
}

function nodeOf(
  nodes: ValheimPlanNode[],
  prefab: string,
  via?: ValheimPlanNode['via']['type'],
): ValheimPlanNode {
  return must(
    nodes.find(
      (n) => n.prefab === prefab && (via === undefined || n.via.type === via),
    ),
    `${prefab} ${via ?? ''} node`,
  );
}

const bronze = graphOf({
  stations: [
    {
      prefab: 'forge',
      name: 'Forge',
      maxLevel: 7,
      stackableExtension: false,
      upgrader: false,
      icon: null,
    },
  ],
  recipes: [
    recipe('Recipe_Bronze', 'Bronze', [res('Copper', 2), res('Tin', 1)]),
  ],
  processors: [
    processor('smelter', 'smelter', 'Coal', 2),
    processor('charcoal_kiln', 'smelter'),
  ],
  processes: [
    proc('smelter', 'CopperOre', 'Copper'),
    proc('smelter', 'TinOre', 'Tin'),
    proc('charcoal_kiln', 'Wood', 'Coal'),
  ],
});

describe('resolvePlan — Bronze chain', () => {
  it('walks Bronze → Copper + Tin → ores + smelter Coal → Coal via kiln (Wood)', () => {
    const plan = resolvePlan(bronze, [item('Bronze')], new Map());
    expect(shape(plan.nodes)).toEqual([
      '0<- Bronze:recipe×1',
      '1<0 Copper:process×2',
      '2<1 CopperOre:gathered×2',
      '3<1 Coal:fuel×4',
      '4<3 Coal:process×4',
      '5<4 Wood:gathered×4',
      '6<0 Tin:process×1',
      '7<6 TinOre:gathered×1',
      '8<6 Coal:fuel×2',
      '9<8 Coal:process×2',
      '10<9 Wood:gathered×2',
    ]);
    expect(nodeOf(plan.nodes, 'Copper').via).toEqual({
      type: 'process',
      processor: 'smelter',
      processorType: 'smelter',
      seconds: 30,
      windPowered: false,
      fuel: 'Coal',
    });
    expect(nodeOf(plan.nodes, 'Copper').crafts).toBe(2);
    expect(plan.shoppingList).toEqual([
      { prefab: 'CopperOre', need: 2, have: 0, short: 2 },
      { prefab: 'Wood', need: 6, have: 0, short: 6 },
      { prefab: 'TinOre', need: 1, have: 0, short: 1 },
    ]);
    expect(plan.truncated).toBe(false);
    expect(plan.fuelEstimates).toEqual([]);
  });

  it('`/tree` (stock null) leaves have/short null on every node and line', () => {
    const tree = resolveTree(bronze, item('Bronze'), null);
    expect(tree.nodes.every((n) => n.have === null && n.short === null)).toBe(
      true,
    );
    expect(
      tree.shoppingList.every((l) => l.have === null && l.short === null),
    ).toBe(true);
    expect(tree.nodes).toHaveLength(11);
  });

  it('stock cut-off: 40 Copper covers the Copper branch, no ore requested', () => {
    const plan = resolvePlan(
      bronze,
      [item('Bronze', 20)],
      new Map([['Copper', 40]]),
    );
    const copper = nodeOf(plan.nodes, 'Copper');
    expect({
      have: copper.have,
      short: copper.short,
      crafts: copper.crafts,
    }).toEqual({ have: 40, short: 0, crafts: 0 });
    expect(plan.nodes.some((n) => n.parentId === copper.id)).toBe(false);
    expect(plan.nodes.some((n) => n.prefab === 'CopperOre')).toBe(false);
    expect(plan.shoppingList).toEqual([
      { prefab: 'TinOre', need: 20, have: 0, short: 20 },
      { prefab: 'Wood', need: 40, have: 0, short: 40 },
    ]);
  });

  it('runs targets in request order against ONE ledger (A3)', () => {
    const plan = resolvePlan(
      bronze,
      [item('Bronze'), item('Bronze')],
      new Map([['Copper', 3]]),
    );
    const coppers = plan.nodes.filter((n) => n.prefab === 'Copper');
    // have = what the ledger held BEFORE each take: 3, then the remainder 1.
    expect(coppers.map((n) => [n.have, n.short])).toEqual([
      [3, 0],
      [1, 1],
    ]);
    expect(plan.shoppingList.find((l) => l.prefab === 'CopperOre')).toEqual({
      prefab: 'CopperOre',
      need: 1,
      have: 0,
      short: 1,
    });
  });

  it('have = the stock available, not min(stock, need); short = max(0, need − have)', () => {
    const plan = resolvePlan(
      bronze,
      [item('Bronze')],
      new Map([['Copper', 40]]),
    );
    expect(nodeOf(plan.nodes, 'Copper')).toMatchObject({
      quantity: 2,
      have: 40,
      short: 0,
    });
    expect(nodeOf(plan.nodes, 'Tin')).toMatchObject({ have: 0, short: 1 });
  });

  it('a shopping line has the stock at its first leaf and sums the shortfalls', () => {
    const plan = resolvePlan(
      bronze,
      [item('Bronze', 2), item('Bronze', 2)],
      new Map([['TinOre', 3]]),
    );
    const tinOre = plan.nodes.filter((n) => n.prefab === 'TinOre');
    expect(tinOre.map((n) => [n.quantity, n.have, n.short])).toEqual([
      [2, 3, 0],
      [2, 1, 1],
    ]);
    expect(plan.shoppingList.find((l) => l.prefab === 'TinOre')).toEqual({
      prefab: 'TinOre',
      need: 4,
      have: 3,
      short: 1,
    });
  });
});

const sword = graphOf({
  stations: [
    {
      prefab: 'forge',
      name: 'Forge',
      maxLevel: 7,
      stackableExtension: false,
      upgrader: true,
      icon: null,
    },
  ],
  recipes: [
    recipe(
      'Recipe_Sword',
      'Sword',
      [res('Iron', 20, 10), res('Leather', 2, 0)],
      { minStationLevel: 2 },
    ),
  ],
});
const q4 = { maxQuality: () => 4 };

describe('resolveTree — per-quality formula (§1.2)', () => {
  it('quality 3 from scratch sums amount + (q-1)·amountPerLevel over q = 1..3', () => {
    const tree = resolveTree(sword, item('Sword', 1, { quality: 3 }), null, q4);
    expect(nodeOf(tree.nodes, 'Iron').quantity).toBe(20 + 10 + 20);
    expect(nodeOf(tree.nodes, 'Leather').quantity).toBe(2);
    const root = nodeOf(tree.nodes, 'Sword');
    expect(root.crafts).toBe(3);
    expect(root.via).toMatchObject({
      type: 'recipe',
      quality: 3,
      station: 'forge',
      stationLevel: 4,
      upgraderStation: true,
    });
  });

  it('upgrade 2 → 3 charges only the q = 3 step and never nets the target', () => {
    const plan = resolvePlan(
      sword,
      [item('Sword', 1, { quality: 3, fromQuality: 2 })],
      new Map([['Sword', 5]]),
      q4,
    );
    expect(shape(plan.nodes)).toEqual([
      '0<- Sword:recipe×1',
      '1<0 Iron:gathered×20',
    ]);
    expect(nodeOf(plan.nodes, 'Sword')).toMatchObject({
      have: 0,
      short: 1,
      crafts: 1,
    });
  });

  it('clamps the target quality to maxQuality (default 1)', () => {
    const tree = resolveTree(sword, item('Sword', 1, { quality: 3 }), null);
    expect(nodeOf(tree.nodes, 'Iron').quantity).toBe(20);
  });

  it('an upgradeOnly recipe is used for q ≥ 2 only', () => {
    const g = graphOf({
      recipes: [
        recipe('Recipe_Cape', 'Cape', [res('Fur', 4, 2)], {
          upgradeOnly: true,
          station: null,
        }),
      ],
    });
    expect(resolveTree(g, item('Cape'), null).nodes[0]?.via.type).toBe(
      'gathered',
    );
    const up = resolveTree(
      g,
      item('Cape', 1, { quality: 2, fromQuality: 1 }),
      null,
      q4,
    );
    expect(shape(up.nodes)).toEqual([
      '0<- Cape:recipe×1',
      '1<0 Fur:gathered×2',
    ]);
    expect(up.nodes[0]?.via).toMatchObject({
      station: 'forge',
      upgradeOnly: true,
    });
  });
});

describe('resolveTree — cycles, sources and caps', () => {
  it('cycle A → B → A ends in a `cycle` leaf that counts as short', () => {
    const g = graphOf({
      recipes: [
        recipe('ra', 'A', [res('B', 1)]),
        recipe('rb', 'B', [res('A', 1)]),
      ],
    });
    const plan = resolvePlan(g, [item('A')], new Map());
    expect(shape(plan.nodes)).toEqual([
      '0<- A:recipe×1',
      '1<0 B:recipe×1',
      '2<1 A:cycle×1',
    ]);
    expect(plan.truncated).toBe(false);
    expect(plan.shoppingList).toEqual([
      { prefab: 'A', need: 1, have: 0, short: 1 },
    ]);
  });

  it('a cyclic batch never credits its surplus to its own prerequisite', () => {
    const g = graphOf({
      recipes: [
        recipe('ra', 'A', [res('B', 1)], { amount: 2 }),
        recipe('rb', 'B', [res('A', 1)]),
      ],
    });
    const plan = resolvePlan(g, [item('A')], new Map());
    expect(nodeOf(plan.nodes, 'A', 'cycle')).toMatchObject({ short: 1 });
    expect(plan.shoppingList).toEqual([
      { prefab: 'A', need: 1, have: 0, short: 1 },
    ]);
  });

  it('a cyclic process batch never credits its surplus to its input', () => {
    const g = graphOf({
      processors: [processor('smelter', 'smelter')],
      processes: [
        proc('smelter', 'B', 'A', { output: { prefab: 'A', amount: 2 } }),
      ],
      recipes: [recipe('rb', 'B', [res('A', 1)])],
    });
    const plan = resolvePlan(g, [item('A')], new Map());
    expect(nodeOf(plan.nodes, 'A', 'cycle')).toMatchObject({ short: 1 });
  });

  it('never auto-picks the obliterator (incinerator)', () => {
    const g = graphOf({
      processors: [processor('incinerator', 'incinerator')],
      processes: [proc('incinerator', 'Sword', 'Coal', { anyOneOf: true })],
    });
    const tree = resolveTree(g, item('Coal', 3), null);
    expect(shape(tree.nodes)).toEqual(['0<- Coal:gathered×3']);
    expect(tree.nodes[0]?.alternatives).toBe(0);
  });

  it('D9: a crafting recipe beats a process; recipe ties go by id', () => {
    const g = graphOf({
      recipes: [
        recipe('b_arrow', 'Arrow', [res('Wood', 1)]),
        recipe('a_arrow', 'Arrow', [res('Flint', 1)]),
        recipe('c_off', 'Arrow', [], { enabled: false }),
      ],
      processors: [processor('aa_oven', 'cooking')],
      processes: [proc('aa_oven', 'Dough', 'Arrow')],
    });
    const root = must(resolveTree(g, item('Arrow'), null).nodes[0], 'root');
    expect(root.via).toMatchObject({ type: 'recipe', recipeId: 'a_arrow' });
    expect(root.alternatives).toBe(2);
  });

  it('D9: process ties go by processor prefab', () => {
    const g = graphOf({
      processors: [
        processor('smelter_b', 'smelter'),
        processor('blast_a', 'smelter'),
      ],
      processes: [
        proc('smelter_b', 'Ore', 'Iron', { priority: 9 }),
        proc('blast_a', 'Scrap', 'Iron'),
      ],
    });
    const root = must(resolveTree(g, item('Iron'), null).nodes[0], 'root');
    expect(root.via).toMatchObject({ type: 'process', processor: 'blast_a' });
    expect(root.alternatives).toBe(1);
  });

  it('caps the node list and flags truncated', () => {
    const plan = resolvePlan(bronze, [item('Bronze')], null, { maxNodes: 3 });
    expect(plan.nodes).toHaveLength(3);
    expect(plan.truncated).toBe(true);
  });

  it('truncated: a crafted node whose children were all cut stays on the list', () => {
    const plan = resolvePlan(bronze, [item('Bronze', 3)], null, {
      maxNodes: 1,
    });
    expect(plan.truncated).toBe(true);
    expect(plan.shoppingList).toEqual([
      { prefab: 'Bronze', need: 3, have: null, short: null },
    ]);
  });

  it(`defaults the node cap to ${VALHEIM_PLAN_NODES_MAX}`, () => {
    const targets = Array.from({ length: 200 }, () => item('Bronze'));
    const plan = resolvePlan(bronze, targets, null);
    expect(plan.nodes).toHaveLength(VALHEIM_PLAN_NODES_MAX);
    expect(plan.truncated).toBe(true);
  });

  it('caps the depth at 16', () => {
    const chain = Array.from({ length: 20 }, (_, k) =>
      recipe(`r${k}`, `I${k}`, [res(`I${k + 1}`, 1)]),
    );
    const tree = resolveTree(graphOf({ recipes: chain }), item('I0'), null);
    expect(tree.nodes).toHaveLength(17);
    expect(tree.nodes.at(-1)?.prefab).toBe('I16');
    expect(tree.truncated).toBe(true);
  });
});

describe('resolvePlan — anyOneOf, cooking fuel, pieces', () => {
  const feast = graphOf({
    recipes: [
      recipe(
        'Recipe_Feast',
        'Feast',
        [res('Meat', 2), res('Fish', 2), res('Bread', 2)],
        { anyOneOf: true },
      ),
    ],
  });

  it('anyOneOf picks the first alternative the ledger covers', () => {
    const plan = resolvePlan(feast, [item('Feast')], new Map([['Fish', 2]]));
    expect(shape(plan.nodes)).toEqual([
      '0<- Feast:recipe×1',
      '1<0 Fish:gathered×2',
    ]);
    expect(plan.nodes[1]).toMatchObject({ alternatives: 2, have: 2, short: 0 });
    expect(plan.nodes[0]?.via).toMatchObject({ anyOneOf: true });
  });

  it('anyOneOf falls back to the first alternative when none is covered', () => {
    const plan = resolvePlan(feast, [item('Feast')], new Map([['Fish', 1]]));
    expect(shape(plan.nodes)).toEqual([
      '0<- Feast:recipe×1',
      '1<0 Meat:gathered×2',
    ]);
  });

  it('smelter fuel is per product, not per run (§5b)', () => {
    const g = graphOf({
      processors: [processor('smelter', 'smelter', 'Coal', 2)],
      processes: [
        proc('smelter', 'Ore', 'Bar', { output: { prefab: 'Bar', amount: 5 } }),
      ],
    });
    const plan = resolvePlan(g, [item('Bar', 10)], new Map());
    expect(shape(plan.nodes)).toEqual([
      '0<- Bar:process×10',
      '1<0 Ore:gathered×2',
      '2<0 Coal:fuel×20',
    ]);
    expect(plan.shoppingList).toContainEqual({
      prefab: 'Coal',
      need: 20,
      have: 0,
      short: 20,
    });
  });

  it('smelter fuel draws per-product Coal from stock', () => {
    const g = graphOf({
      processors: [processor('smelter', 'smelter', 'Coal', 2)],
      processes: [
        proc('smelter', 'Ore', 'Bar', { output: { prefab: 'Bar', amount: 5 } }),
      ],
    });
    const plan = resolvePlan(g, [item('Bar', 10)], new Map([['Coal', 15]]));
    const fuel = nodeOf(plan.nodes, 'Coal');
    expect({ have: fuel.have, short: fuel.short }).toEqual({
      have: 15,
      short: 5,
    });
  });

  it('cooking fuel is an estimate, not a fuel node', () => {
    const g = graphOf({
      processors: [processor('oven', 'cooking', 'Wood')],
      processes: [proc('oven', 'Dough', 'Bread', { seconds: 50 })],
    });
    const plan = resolvePlan(g, [item('Bread', 2)], new Map());
    expect(shape(plan.nodes)).toEqual([
      '0<- Bread:process×2',
      '1<0 Dough:gathered×2',
    ]);
    expect(plan.fuelEstimates).toEqual([
      { prefab: 'Wood', processor: 'oven', seconds: 100 },
    ]);
  });

  it('a piece target expands its resources × amount', () => {
    const g = graphOf({
      pieces: [
        {
          prefab: 'forge',
          name: 'Forge',
          category: 'Crafting',
          tool: 'Hammer',
          station: 'workbench',
          icon: null,
          resources: [
            { prefab: 'Stone', amount: 4, recover: true },
            { prefab: 'Coins', amount: 0, recover: false },
          ],
        },
      ],
    });
    const tree = resolveTree(g, item('forge', 2), null);
    expect(shape(tree.nodes)).toEqual([
      '0<- forge:recipe×2',
      '1<0 Stone:gathered×8',
    ]);
    expect(tree.nodes[0]?.via).toMatchObject({
      recipeId: 'forge',
      station: 'workbench',
      stationLevel: 1,
      quality: 1,
    });
  });
});

describe('resolvePlan — quantity bound (VALHEIM_PLAN_QUANTITY_MAX)', () => {
  const huge = graphOf({
    recipes: [
      recipe('r_a', 'ModA', [res('ModB', 10_000)]),
      recipe('r_b', 'ModB', [res('ModC', 10_000)]),
      recipe('r_c', 'ModC', [res('ModD', 10_000)]),
    ],
  });

  it('clamps an oversized branch to the max, stops it there and flags truncated', () => {
    const targets = [item('ModA', 10_000)];
    const plan = resolvePlan(huge, targets, new Map());
    expect(shape(plan.nodes)).toEqual([
      '0<- ModA:recipe×10000',
      '1<0 ModB:recipe×100000000',
      `2<1 ModC:recipe×${VALHEIM_PLAN_QUANTITY_MAX}`,
    ]);
    expect(plan.truncated).toBe(true);
    const counts = plan.nodes.flatMap((n) => [
      n.quantity,
      n.crafts,
      n.have ?? 0,
      n.short ?? 0,
    ]);
    const lines = plan.shoppingList.flatMap((l) => [
      l.need,
      l.have ?? 0,
      l.short ?? 0,
    ]);
    expect(Math.max(...counts, ...lines)).toBeLessThanOrEqual(
      VALHEIM_PLAN_QUANTITY_MAX,
    );
    expect(plan.shoppingList).toEqual([
      {
        prefab: 'ModC',
        need: VALHEIM_PLAN_QUANTITY_MAX,
        have: 0,
        short: VALHEIM_PLAN_QUANTITY_MAX,
      },
    ]);
    const body = {
      ...emptyPlan(targets),
      stock: 'scan' as const,
      nodes: plan.nodes,
      truncated: plan.truncated,
      shoppingList: plan.shoppingList,
      fuelEstimates: plan.fuelEstimates,
    };
    expect(ValheimRecipePlanResponseSchema.safeParse(body).success).toBe(true);
  });
});

const piece = (prefab: string, resources: [string, number][]) => ({
  prefab,
  name: prefab,
  category: 'Building',
  tool: 'Hammer',
  station: 'workbench',
  icon: null,
  resources: resources.map(([p, amount]) => ({
    prefab: p,
    amount,
    recover: true,
  })),
});

describe('resolvePlan — piece netting and list truncation', () => {
  it('a piece target never nets a same-prefab item from stock', () => {
    const g = graphOf({
      recipes: [recipe('Recipe_Shared', 'Shared', [res('Iron', 1)])],
      pieces: [piece('Shared', [['Wood', 10]])],
    });
    const target = item('Shared', 1, { kind: 'piece' });
    const plan = resolvePlan(g, [target], new Map([['Shared', 1]]));
    expect(shape(plan.nodes)).toEqual([
      '0<- Shared:recipe×1',
      '1<0 Wood:gathered×10',
    ]);
    expect(plan.nodes[0]).toMatchObject({ have: 0, short: 1, crafts: 1 });
    expect(plan.shoppingList).toEqual([
      { prefab: 'Wood', need: 10, have: 0, short: 10 },
    ]);
  });

  it('a shopping total capped at the max reports truncated', () => {
    const g = graphOf({
      recipes: [recipe('r_w', 'ModW', [res('Wood', 10_000)])],
    });
    const targets = Array.from({ length: 20 }, () => item('ModW', 10_000));
    const plan = resolvePlan(g, targets, new Map());
    expect(nodeOf(plan.nodes, 'Wood').quantity).toBe(100_000_000);
    expect({ truncated: plan.truncated, list: plan.shoppingList }).toEqual({
      truncated: true,
      list: [
        {
          prefab: 'Wood',
          need: VALHEIM_PLAN_QUANTITY_MAX,
          have: 0,
          short: VALHEIM_PLAN_QUANTITY_MAX,
        },
      ],
    });
  });
});

describe('resolvePlan — batch surplus across branches', () => {
  const nails = graphOf({
    recipes: [
      recipe('Recipe_Nails', 'BronzeNails', [res('Bronze', 1)], {
        amount: 20,
      }),
    ],
    pieces: [
      piece('wall_a', [['BronzeNails', 4]]),
      piece('wall_b', [['BronzeNails', 4]]),
    ],
  });

  it('a later branch reuses an earlier batch surplus (20 nails per Bronze)', () => {
    const targets = [item('wall_a'), item('wall_b')];
    const plan = resolvePlan(nails, targets, new Map());
    const nailNodes = plan.nodes.filter((n) => n.prefab === 'BronzeNails');
    expect(nailNodes.map((n) => [n.quantity, n.crafts, n.have])).toEqual([
      [4, 1, 0],
      [4, 0, 0],
    ]);
    expect(plan.shoppingList).toEqual([
      { prefab: 'Bronze', need: 1, have: 0, short: 1 },
    ]);
  });

  it('`/tree` of one batch target is unchanged by the surplus ledger', () => {
    const tree = resolveTree(nails, item('wall_a'), null);
    expect(shape(tree.nodes)).toEqual([
      '0<- wall_a:recipe×1',
      '1<0 BronzeNails:recipe×4',
      '2<1 Bronze:gathered×1',
    ]);
    expect(nodeOf(tree.nodes, 'BronzeNails')).toMatchObject({
      crafts: 1,
      have: null,
      short: null,
    });
  });
});

describe('resolvePlan — target kind inference', () => {
  const g = graphOf({
    processors: [processor('smelter', 'smelter')],
    processes: [proc('smelter', 'Ore', 'Shared')],
    pieces: [piece('Shared', [['Wood', 10]])],
  });

  it('no kind: a process output that is also a piece takes the item path', () => {
    expect(shape(resolveTree(g, item('Shared'), null).nodes)).toEqual([
      '0<- Shared:process×1',
      '1<0 Ore:gathered×1',
    ]);
  });

  it('kind piece: the same prefab is priced as a build', () => {
    const tree = resolveTree(g, item('Shared', 1, { kind: 'piece' }), null);
    expect(shape(tree.nodes)).toEqual([
      '0<- Shared:recipe×1',
      '1<0 Wood:gathered×10',
    ]);
  });
});
