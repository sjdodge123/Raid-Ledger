/**
 * ROK-1894 — Valheim 1.0.x per-quality cost, measured on the 1.0.20 prod
 * server (live `Requirement.GetAmount(q)` of `Recipe_ArmorBronzeChest`:
 * Bronze 5/3/6/12, DeerHide 2/0/0/0, Upgrader1Armor 1/1/1/1).
 */
import type {
  ValheimPlanNode,
  ValheimRecipeResource,
} from '@raid-ledger/contract';
import { amountAt, costRuleFor } from './valheim-recipes.cost-rule';
import { buildRecipeGraph } from './valheim-recipes.graph';
import { resolveTree } from './valheim-recipes.resolve';

const res = (
  prefab: string,
  amount: number,
  amountPerLevel = 0,
  upgraderResource?: boolean,
): ValheimRecipeResource => ({
  prefab,
  amount,
  amountPerLevel,
  extraAmountOnlyOneIngredient: 0,
  recover: true,
  ...(upgraderResource === undefined ? {} : { upgraderResource }),
});

const cuirass = (gameVersion?: string) =>
  buildRecipeGraph({
    ...(gameVersion === undefined ? {} : { gameVersion }),
    recipes: [
      {
        id: 'Recipe_ArmorBronzeChest',
        result: 'ArmorBronzeChest',
        amount: 1,
        enabled: true,
        station: 'forge',
        repairStation: null,
        minStationLevel: 1,
        upgradeOnly: false,
        anyOneOf: false,
        qualityResultAmountMultiplier: 1,
        formula: 'vanilla',
        resources: [
          res('Bronze', 5, 3),
          res('DeerHide', 2),
          res('Upgrader1Armor', 1, 0, true),
        ],
      },
    ],
    pieces: [],
    stations: [],
    processors: [],
    processes: [],
  });

const q4 = { maxQuality: () => 4 };

function quantities(nodes: ValheimPlanNode[]): Record<string, number> {
  return Object.fromEntries(
    nodes.filter((n) => n.parentId !== null).map((n) => [n.prefab, n.quantity]),
  );
}

function tree(gameVersion: string | undefined, quality: number, from = 0) {
  const target = {
    prefab: 'ArmorBronzeChest',
    quality,
    amount: 1,
    fromQuality: from,
  };
  return resolveTree(cuirass(gameVersion), target, null, q4).nodes;
}

describe('per-quality cost rule (ROK-1894)', () => {
  it('1.0.x, q4 from scratch: ×2 per level from q3, one upgrade item per step', () => {
    expect(quantities(tree('1.0.20', 4))).toEqual({
      Bronze: 5 + 3 + 6 + 12,
      DeerHide: 2,
      Upgrader1Armor: 4,
    });
  });

  it('1.0.x, upgrading q3 → q4 charges only the q4 step', () => {
    expect(quantities(tree('1.0.20', 4, 3))).toEqual({
      Bronze: 12,
      Upgrader1Armor: 1,
    });
  });

  it('a 0.221.x set, or one without a gameVersion, keeps the old rule', () => {
    for (const v of ['0.221.4', undefined]) {
      expect(quantities(tree(v, 4))).toEqual({
        Bronze: 5 + 3 + 6 + 9,
        DeerHide: 2,
        Upgrader1Armor: 1,
      });
    }
  });

  it('up to q3 both rules agree for ordinary resources', () => {
    const r = res('Iron', 20, 10);
    for (const q of [1, 2, 3])
      expect(amountAt(r, q, 'v1')).toBe(amountAt(r, q, 'v0'));
  });

  it('picks the rule from the major version', () => {
    expect(costRuleFor('1.0.20')).toBe('v1');
    expect(costRuleFor('1.0.0')).toBe('v1');
    expect(costRuleFor('0.221.4')).toBe('v0');
    expect(costRuleFor(undefined)).toBe('v0');
    expect(costRuleFor('')).toBe('v0');
  });
});
