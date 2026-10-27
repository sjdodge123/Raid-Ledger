/**
 * ROK-2014 — the Materials trend mappers: D10 daily deltas over the newest
 * four headers, D12 (only shown prefabs), AC3 (fewer than two days → no
 * field), OPEN-1 base matching, and the attach step on every row set.
 */
import type {
  ValheimMaterialStack,
  ValheimMaterialsResponse,
} from '@raid-ledger/contract';
import {
  indexBaseSums,
  indexItemSums,
  matchDayBases,
  toTrend,
} from './valheim-materials-trend.mappers';
import { withMaterialsTrend } from './valheim-materials-bases.service-helpers';
import type {
  TrendBaseSumRow,
  TrendItemSumRow,
} from './valheim-materials-trend.queries';

const KEY_A = 'A'.repeat(22);
const KEY_OLD = 'B'.repeat(22);
const KEY_FAR = 'C'.repeat(22);
// Newest first, as the query returns them: 4 headers → 3 deltas.
const DAYS = [
  { id: 4, playDate: '2026-10-17' },
  { id: 3, playDate: '2026-10-16' },
  { id: 2, playDate: '2026-10-14' },
  { id: 1, playDate: '2026-10-11' },
];
const item = (
  dayId: number,
  prefab: string,
  total: number,
  shared = true,
): TrendItemSumRow => ({ dayId, prefab, shared, total: String(total) });
const stack = (prefab: string, total = 1): ValheimMaterialStack => ({
  prefab,
  quality: 1,
  total,
  chests: 1,
});
// Shared Wood 12 → 22 → 37 → 57; Stone 30 → 20 (a net drop, absent day 1–2).
const ITEMS = [
  item(1, 'Wood', 12),
  item(2, 'Wood', 22),
  item(3, 'Wood', 37),
  item(4, 'Wood', 57),
  item(3, 'Stone', 30),
  item(4, 'Stone', 20),
  item(2, 'Hidden', 5),
  item(3, 'Coins', 100, false),
];
const SHOWN = new Set(['Wood', 'Stone']);

describe('toTrend (D10, D12, AC3)', () => {
  const shared = indexItemSums(ITEMS).shared;

  it('newest first: end minus the previous stored day, zero deltas omitted', () => {
    expect(toTrend(DAYS, shared, SHOWN)).toEqual({
      days: [
        { date: '2026-10-17', gains: { Wood: 20, Stone: -10 } },
        { date: '2026-10-16', gains: { Wood: 15, Stone: 30 } },
        { date: '2026-10-14', gains: { Wood: 10 } },
      ],
    });
  });

  it('sorts unordered headers itself', () => {
    const t = toTrend([...DAYS].reverse(), shared, SHOWN);
    expect(t?.days.map((d) => d.date)).toEqual([
      '2026-10-17',
      '2026-10-16',
      '2026-10-14',
    ]);
  });

  it('a prefab outside the shown row set never appears (D12)', () => {
    const t = toTrend(DAYS, shared, SHOWN);
    const keys = t?.days.flatMap((d) => Object.keys(d.gains)) ?? [];
    expect(keys).not.toContain('Hidden');
    expect(keys).not.toContain('Coins');
  });

  it('a `__proto__` prefab keeps its gain through serialisation (Codex P2)', () => {
    const totals = indexItemSums([
      item(3, '__proto__', 4),
      item(4, '__proto__', 9),
    ]).shared;
    const t = toTrend(DAYS.slice(0, 2), totals, new Set(['__proto__']));
    expect(JSON.parse(JSON.stringify(t))).toEqual({
      days: [{ date: '2026-10-17', gains: JSON.parse('{"__proto__":5}') }],
    });
  });

  it('zero or one header day → undefined (no field)', () => {
    expect(toTrend([], shared, SHOWN)).toBeUndefined();
    expect(toTrend(DAYS.slice(0, 1), shared, SHOWN)).toBeUndefined();
  });

  it('two days with no change → one day, empty gains', () => {
    expect(toTrend(DAYS.slice(0, 2), new Map(), SHOWN)).toEqual({
      days: [{ date: '2026-10-17', gains: {} }],
    });
  });

  it('personal rows index apart from shared ones', () => {
    const personal = indexItemSums(ITEMS).personal;
    expect(toTrend(DAYS, personal, new Set(['Coins']))?.days[1]).toEqual({
      date: '2026-10-16',
      gains: { Coins: 100 },
    });
  });
});

const baseRow = (
  dayId: number,
  baseKey: string,
  x: number,
  total: number,
): TrendBaseSumRow => ({
  ...item(dayId, 'Wood', total),
  baseKey,
  baseX: x,
  baseZ: 0,
});

describe('matchDayBases (OPEN-1, one-to-one)', () => {
  const idx = indexBaseSums([
    baseRow(1, KEY_OLD, 10, 5),
    baseRow(1, KEY_FAR, 200, 9),
    baseRow(2, KEY_A, 0, 8),
  ]);
  const anchor = { key: KEY_A, x: 0, z: 0 };
  const day = (id: number) => idx.get(id) ?? new Map();
  const wood = (
    m: Map<string, { totals: { shared: Map<string, number> } } | null>,
  ) => m.get(KEY_A)?.totals.shared.get('Wood');

  it('same key wins', () => {
    expect(wood(matchDayBases(day(2), [anchor]))).toBe(8);
  });

  it('else the nearest unclaimed base within 64 m', () => {
    expect(wood(matchDayBases(day(1), [anchor]))).toBe(5);
    // KEY_OLD is still a base today → claimed by its own key, not a fallback.
    const old = { key: KEY_OLD, x: 10, z: 0 };
    expect(matchDayBases(day(1), [anchor, old]).get(KEY_A)).toBeUndefined();
  });

  it('beyond 64 m or without a centroid → no match', () => {
    const far = { key: KEY_A, x: 500, z: 0 };
    expect(matchDayBases(day(1), [far]).size).toBe(0);
    const nan = { key: KEY_A, x: Number.NaN, z: Number.NaN };
    expect(matchDayBases(day(1), [nan]).size).toBe(0);
  });

  it('a base that split links to neither half: both ambiguous (null)', () => {
    const halves = [
      { key: KEY_A, x: 0, z: 0 },
      { key: 'D'.repeat(22), x: 20, z: 0 },
    ];
    expect([...matchDayBases(day(1), halves)]).toEqual([
      [KEY_A, null],
      ['D'.repeat(22), null],
    ]);
  });

  it('two drifted bases each keep their own nearest day base', () => {
    const two = indexBaseSums([
      baseRow(1, KEY_OLD, 0, 5),
      baseRow(1, KEY_FAR, 200, 9),
    ]);
    const now = [
      { key: KEY_A, x: 5, z: 0 },
      { key: 'D'.repeat(22), x: 205, z: 0 },
    ];
    const m = matchDayBases(two.get(1) ?? new Map(), now);
    expect(wood(m)).toBe(5);
    expect(m.get('D'.repeat(22))?.totals.shared.get('Wood')).toBe(9);
  });
});

function response(): ValheimMaterialsResponse {
  return {
    worldUid: 'w',
    capturedAt: '2026-10-17T20:15:00.000Z',
    gameVersion: null,
    catalogFallback: false,
    shared: {
      totals: [stack('Wood'), stack('Stone')],
      chestCount: 1,
      warnings: { unreadable: 0, omittedEntries: 0, omittedShared: 0 },
    },
    personal: {
      totals: [stack('Coins')],
      chestCount: 1,
      omittedPrivate: null,
      byBase: [
        { base: KEY_A, chestCount: 1, totals: [stack('Coins')] },
        { base: null, chestCount: 1, totals: [stack('Coins')] },
      ],
    },
    bases: [
      {
        key: KEY_A,
        x: 0,
        z: 0,
        chestCount: 1,
        vehicleCount: 0,
        totals: [stack('Wood')],
      },
    ],
    items: {},
    atlas: null,
  };
}

describe('withMaterialsTrend', () => {
  const bases: TrendBaseSumRow[] = [
    baseRow(3, KEY_OLD, 20, 37), // drifted key, 20 m away → matched
    baseRow(4, KEY_A, 0, 57),
    {
      ...baseRow(3, KEY_OLD, 20, 0),
      prefab: 'Coins',
      shared: false,
      total: '100',
    },
  ];

  it('attaches to shared, personal, bases[] and byBase[] with a base', () => {
    const out = withMaterialsTrend(response(), {
      days: DAYS,
      items: ITEMS,
      bases,
    });
    expect(out.shared.trend?.days[0]).toEqual({
      date: '2026-10-17',
      gains: { Wood: 20, Stone: -10 },
    });
    expect(out.bases?.[0]?.trend?.days.map((d) => d.gains)).toEqual([
      { Wood: 20 },
      { Wood: 37 },
      {},
    ]);
    expect(out.personal?.trend?.days[1]?.gains).toEqual({ Coins: 100 });
    expect(out.personal?.byBase?.[0]?.trend?.days[1]?.gains).toEqual({
      Coins: 100,
    });
    expect(out.personal?.byBase?.[1]).not.toHaveProperty('trend');
  });

  it('fewer than two days → the response unchanged, no trend keys (AC3)', () => {
    const res = response();
    const out = withMaterialsTrend(res, {
      days: DAYS.slice(0, 1),
      items: [],
      bases: [],
    });
    expect(out).toBe(res);
    expect(out.shared).not.toHaveProperty('trend');
    expect(out.bases?.[0]).not.toHaveProperty('trend');
  });

  it('a null personal section stays null', () => {
    const out = withMaterialsTrend(
      { ...response(), personal: null },
      { days: DAYS, items: ITEMS, bases },
    );
    expect(out.personal).toBeNull();
  });
});

describe('withMaterialsTrend — base split', () => {
  it('a base split into two halves reads no trend on either (Codex P2)', () => {
    const res = response();
    const half = (key: string, x: number) => ({
      key,
      x,
      z: 0,
      chestCount: 1,
      vehicleCount: 0,
      totals: [stack('Wood', 10)],
    });
    res.bases = [half(KEY_A, -20), half(KEY_FAR, 20)];
    const split: TrendBaseSumRow[] = [
      baseRow(3, KEY_OLD, 0, 20), // one base of 20 Wood yesterday
      baseRow(4, KEY_A, -20, 10),
      baseRow(4, KEY_FAR, 20, 10),
    ];
    const out = withMaterialsTrend(res, {
      days: DAYS,
      items: ITEMS,
      bases: split,
    });
    // Old matcher: both halves claimed the 20 → two −10 trends.
    expect(out.bases?.map((b) => b.trend ?? null)).toEqual([null, null]);
  });
});
