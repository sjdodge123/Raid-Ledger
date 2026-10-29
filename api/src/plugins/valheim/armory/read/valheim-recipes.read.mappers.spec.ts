import { BadRequestException } from '@nestjs/common';
import {
  VALHEIM_PLAN_SOURCES_MAX,
  VALHEIM_PLAN_TARGETS_MAX,
  type ValheimPiece,
  type ValheimRecipe,
} from '@raid-ledger/contract';
import type { ValheimItemCatalogEntryRow } from '../../../../drizzle/schema';
import { maxQualityLookup } from './valheim-recipes.catalog.helpers';
import { buildRecipeGraph } from './valheim-recipes.graph';
import {
  clampTargets,
  hasTreeTarget,
  parseIncludePersonal,
  parsePlanTargets,
  parseSourceOverrides,
  parseTreeQuality,
  toStockMap,
} from './valheim-recipes.read.mappers';

function recipe(id: string, result: string): ValheimRecipe {
  return {
    id,
    result,
    amount: 1,
    enabled: true,
    station: null,
    repairStation: null,
    minStationLevel: 1,
    upgradeOnly: false,
    anyOneOf: false,
    qualityResultAmountMultiplier: 1,
    formula: 'vanilla',
    resources: [],
  };
}

function piece(prefab: string): ValheimPiece {
  return {
    prefab,
    name: prefab,
    category: 'Building',
    tool: 'Hammer',
    station: null,
    icon: null,
    resources: [],
  };
}

function entry(maxQuality: number): ValheimItemCatalogEntryRow {
  return {
    name: 'Iron sword',
    category: 'Weapon',
    maxStack: 1,
    maxQuality,
    variants: 0,
    icon: null,
  };
}

const graph = buildRecipeGraph({
  recipes: [recipe('Recipe_SwordIron', 'SwordIron')],
  pieces: [piece('woodwall')],
  stations: [],
  processors: [],
  processes: [],
});

function badRequest(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof BadRequestException) return err.message;
    throw err;
  }
  throw new Error('expected a BadRequestException, got none');
}

describe('parsePlanTargets', () => {
  it('parses <prefab>:<q>:<n> and the optional :<fromQ>, fromQuality default 0', () => {
    expect(parsePlanTargets('SwordIron:3:2,woodwall:1:10:0,Bow:4:1:2')).toEqual(
      [
        { prefab: 'SwordIron', quality: 3, amount: 2, fromQuality: 0 },
        { prefab: 'woodwall', quality: 1, amount: 10, fromQuality: 0 },
        { prefab: 'Bow', quality: 4, amount: 1, fromQuality: 2 },
      ],
    );
  });

  it('passes an optional 5th :<kind> segment through; omitted stays absent (item)', () => {
    expect(
      parsePlanTargets('piece_chest:1:2:0:piece,Bronze:1:1:0:item'),
    ).toEqual([
      {
        prefab: 'piece_chest',
        quality: 1,
        amount: 2,
        fromQuality: 0,
        kind: 'piece',
      },
      { prefab: 'Bronze', quality: 1, amount: 1, fromQuality: 0, kind: 'item' },
    ]);
    expect(parsePlanTargets('Bronze:1:1')[0]).not.toHaveProperty('kind');
  });

  it.each([
    ['SwordIron:11:1', 'quality above 10'],
    ['SwordIron:0:1', 'quality 0'],
    ['SwordIron:1:10001', 'amount above 10 000'],
    ['SwordIron:1:0', 'amount 0'],
    ['Sword Iron:1:1', 'prefab outside the id regex'],
    ['SwordIron:1', 'too few parts'],
    ['SwordIron:1:1:0:item:x', 'too many parts'],
    ['SwordIron:1:1:0:9', 'a kind other than item|piece'],
    ['Bow:2:1:2', 'fromQuality equal to quality'],
    ['Bow:2:1:3', 'fromQuality above quality'],
    ['SwordIron:1.5:1', 'non-integer quality'],
    ['SwordIron:1:1,', 'empty trailing target'],
  ])('400s on %s (%s)', (raw) => {
    expect(badRequest(() => parsePlanTargets(raw))).toBe('Invalid targets');
  });

  it('400s on a missing / empty / repeated param and on more than VALHEIM_PLAN_TARGETS_MAX targets', () => {
    expect(badRequest(() => parsePlanTargets(undefined))).toBe(
      'Invalid targets',
    );
    expect(badRequest(() => parsePlanTargets(''))).toBe('Invalid targets');
    expect(badRequest(() => parsePlanTargets(['A:1:1', 'B:1:1']))).toBe(
      'Invalid targets',
    );
    const many = Array.from(
      { length: VALHEIM_PLAN_TARGETS_MAX + 1 },
      () => 'Wood:1:1',
    ).join(',');
    expect(badRequest(() => parsePlanTargets(many))).toBe('Too many targets');
    expect(parsePlanTargets(many.split(',').slice(1).join(','))).toHaveLength(
      VALHEIM_PLAN_TARGETS_MAX,
    );
  });
});

describe('parseTreeQuality', () => {
  it('defaults to 1, accepts 1..10, 400s outside or non-integer', () => {
    expect(parseTreeQuality(undefined)).toBe(1);
    expect(parseTreeQuality('10')).toBe(10);
    for (const raw of ['11', '0', '2.5', '-1', 'abc', ['2']]) {
      expect(badRequest(() => parseTreeQuality(raw))).toBe('Invalid quality');
    }
  });
});

describe('quality clamp', () => {
  it('reads maxQuality from the catalogue; piece-only, unknown and inherited keys are 1', () => {
    const items = { SwordIron: entry(4) };
    const maxQ = maxQualityLookup(graph, items);
    expect(maxQ('SwordIron')).toBe(4);
    expect(maxQ('woodwall')).toBe(1);
    expect(maxQ('Nope')).toBe(1);
    expect(maxQ('constructor')).toBe(1);
    expect(maxQualityLookup(graph, null)('SwordIron')).toBe(1);
  });

  it('clamps each target quality to its maxQuality, keeping the rest', () => {
    const maxQ = maxQualityLookup(graph, { SwordIron: entry(4) });
    const out = clampTargets(
      [
        { prefab: 'SwordIron', quality: 9, amount: 2, fromQuality: 1 },
        { prefab: 'SwordIron', quality: 3, amount: 1, fromQuality: 0 },
      ],
      maxQ,
    );
    expect(out.map((t) => [t.quality, t.amount, t.fromQuality])).toEqual([
      [4, 2, 1],
      [3, 1, 0],
    ]);
  });

  it('clamps fromQuality below the clamped quality (q1 → from scratch)', () => {
    const maxQ = maxQualityLookup(graph, { SwordIron: entry(4) });
    const out = clampTargets(
      [
        { prefab: 'SwordIron', quality: 10, amount: 1, fromQuality: 5 },
        { prefab: 'woodwall', quality: 3, amount: 1, fromQuality: 2 },
      ],
      maxQ,
    );
    expect(out.map((t) => [t.quality, t.fromQuality])).toEqual([
      [4, 3],
      [1, 0],
    ]);
  });
});

describe('hasTreeTarget (the /tree 404 rule)', () => {
  it('needs a source of the asked kind; no kind accepts either', () => {
    expect(hasTreeTarget(graph, 'SwordIron', undefined)).toBe(true);
    expect(hasTreeTarget(graph, 'woodwall', undefined)).toBe(true);
    expect(hasTreeTarget(graph, 'Wood', undefined)).toBe(false);
    expect(hasTreeTarget(graph, 'SwordIron', 'piece')).toBe(false);
    expect(hasTreeTarget(graph, 'woodwall', 'item')).toBe(false);
    expect(hasTreeTarget(graph, 'woodwall', 'piece')).toBe(true);
  });
});

describe('stock input', () => {
  it('sums every quality per prefab (D7); bigint strings become numbers', () => {
    const stock = toStockMap([
      { prefab: 'Wood', quality: 1, total: '120', chests: '2' },
      { prefab: 'SwordIron', quality: 1, total: '1', chests: '1' },
      { prefab: 'SwordIron', quality: 3, total: 2, chests: 1 },
    ]);
    expect([...stock]).toEqual([
      ['Wood', 120],
      ['SwordIron', 3],
    ]);
  });

  it('includePersonal defaults to false; only true/false accepted', () => {
    expect(parseIncludePersonal(undefined)).toBe(false);
    expect(parseIncludePersonal('true')).toBe(true);
    expect(badRequest(() => parseIncludePersonal('yes'))).toBe(
      'Invalid includePersonal',
    );
  });
});

describe('parseSourceOverrides (ROK-1860 D3)', () => {
  it('absent or empty → no overrides', () => {
    expect([...parseSourceOverrides(undefined)]).toEqual([]);
    expect([...parseSourceOverrides('')]).toEqual([]);
  });

  it('parses recipe and process refs per prefab', () => {
    expect([
      ...parseSourceOverrides('Bronze:r:Recipe_Bronze5,Coal:p:charcoal_kiln:1'),
    ]).toEqual([
      ['Bronze', { type: 'recipe', recipeId: 'Recipe_Bronze5' }],
      ['Coal', { type: 'process', processor: 'charcoal_kiln', index: 1 }],
    ]);
  });

  it('a repeated prefab: the last one wins', () => {
    expect([
      ...parseSourceOverrides('Bronze:r:Recipe_A,Bronze:p:smelter:0'),
    ]).toEqual([
      ['Bronze', { type: 'process', processor: 'smelter', index: 0 }],
    ]);
  });

  it(`accepts exactly ${VALHEIM_PLAN_SOURCES_MAX} entries`, () => {
    const raw = Array.from(
      { length: VALHEIM_PLAN_SOURCES_MAX },
      (_, i) => `P${i}:r:R${i}`,
    ).join(',');
    expect(parseSourceOverrides(raw).size).toBe(VALHEIM_PLAN_SOURCES_MAX);
  });

  it.each([
    ['bad type letter', 'Bronze:x:Recipe_Bronze'],
    ['missing recipe id', 'Bronze:r'],
    ['empty recipe id', 'Bronze:r:'],
    ['extra recipe part', 'Bronze:r:Recipe_Bronze:1'],
    ['missing process index', 'Bronze:p:smelter'],
    ['non-numeric index', 'Bronze:p:smelter:x'],
    ['negative index', 'Bronze:p:smelter:-1'],
    ['index over 63', 'Bronze:p:smelter:64'],
    ['empty prefab', ':r:Recipe_Bronze'],
    ['prefab outside the id charset', 'Bro nze:r:Recipe_Bronze'],
    ['recipe id outside the id charset', 'Bronze:r:Recipe$Bronze'],
    ['processor outside the id charset', 'Bronze:p:smel/ter:0'],
    ['an empty entry', 'Bronze:r:Recipe_Bronze,'],
    [
      'more than the cap',
      Array.from(
        { length: VALHEIM_PLAN_SOURCES_MAX + 1 },
        (_, i) => `P${i}:r:R${i}`,
      ).join(','),
    ],
  ])('400 Invalid sources: %s', (_label, raw) => {
    expect(() => parseSourceOverrides(raw)).toThrow(
      new BadRequestException('Invalid sources'),
    );
  });

  it('400 when repeated as an array', () => {
    expect(() => parseSourceOverrides(['Bronze:r:A', 'Coal:r:B'])).toThrow(
      new BadRequestException('Invalid sources'),
    );
  });
});
