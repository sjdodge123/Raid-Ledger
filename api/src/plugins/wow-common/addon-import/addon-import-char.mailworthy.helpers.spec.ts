/**
 * ROK-2148 review r1 — the multi-row Mailworthy upserts lock rows in
 * `nameKey` order, so overlapping concurrent imports cannot deadlock.
 */
import {
  MAX_ITEMS_ALL_TIME,
  anyGiverNewer,
  clampGiver,
  giverPrecedence,
  sortByNameKey,
  type MailworthyRoster,
} from './addon-import-char.mailworthy.helpers';
import type { GuildMailworthyGiverSource } from '../../../drizzle/schema/guild-mailworthy';

describe('sortByNameKey', () => {
  it('orders rows by nameKey without mutating the input', () => {
    const rows = [
      { nameKey: 'member2', n: 1 },
      { nameKey: 'ana forever', n: 2 },
      { nameKey: 'zed', n: 3 },
      { nameKey: 'anabelle forever', n: 4 },
    ];
    const sorted = sortByNameKey(rows);
    expect(sorted.map((r) => r.nameKey)).toEqual([
      'ana forever',
      'anabelle forever',
      'member2',
      'zed',
    ]);
    expect(rows[0]?.nameKey).toBe('member2');
  });

  it('gives the same order whatever order the payload arrived in', () => {
    const keys = ['c', 'a', 'b'].map((nameKey) => ({ nameKey }));
    const reversed = [...keys].reverse();
    expect(sortByNameKey(keys)).toEqual(sortByNameKey(reversed));
  });
});

/** Codex P2 — `items_all_time` is int32; an overflow rolled back the import. */
describe('clampGiver int32 cap', () => {
  const giver = (itemsAllTime: number, items: number[]) => ({
    characterName: 'Ana Forever',
    itemsAllTime,
    countingSince: 1_790_000_000,
    asOf: 1_790_000_000,
    days: items.map((n, i) => ({ day: 20_000 + i, items: n })),
  });

  it('caps a day sum of 2147483647 + 1 at 2147483647', () => {
    const out = clampGiver(giver(0, [MAX_ITEMS_ALL_TIME, 1]));
    expect(out.itemsAllTime).toBe(2_147_483_647);
  });

  it('caps an over-int32 reported all-time too; keeps in-range values', () => {
    expect(clampGiver(giver(MAX_ITEMS_ALL_TIME + 1, [])).itemsAllTime).toBe(
      MAX_ITEMS_ALL_TIME,
    );
    expect(clampGiver(giver(5, [3, 4])).itemsAllTime).toBe(7);
  });
});

/** Codex P2 — a stale/noop char export previews as applicable only for givers the apply would write. */
const NOW_MS = 1_790_000_600_000;
const GEN = 1_790_000_100;
const giver = (characterName: string, asOf: number) => ({
  characterName,
  itemsAllTime: 1,
  countingSince: 1_789_000_000,
  asOf,
  days: [],
});
const at = (s: number) => new Date(s * 1000);
const rank = (
  source: GuildMailworthyGiverSource,
  asOf: number,
  generatedAt = GEN,
) => ({ source, asOf: at(asOf), generatedAt: at(generatedAt) });
/** Exporter "me" (user 1); "ana" is linked to user 2; "bob" is unlinked. */
const roster: MailworthyRoster = {
  exporterKey: 'me',
  byKey: new Map([
    ['me', { rankIndex: 3, ownerUserIds: [1] }],
    ['ana', { rankIndex: 3, ownerUserIds: [2] }],
    ['bob', { rankIndex: 3, ownerUserIds: [] }],
  ]),
};
const newer = (
  givers: ReturnType<typeof giver>[],
  stored: Map<string, ReturnType<typeof rank>>,
  opts: { userId?: number; generatedAt?: number } = {},
) =>
  anyGiverNewer({
    block: { givers, generatedAt: opts.generatedAt ?? GEN },
    roster,
    userId: opts.userId ?? 1,
    stored,
    nowMs: NOW_MS,
  });

describe('anyGiverNewer', () => {
  it('true for an on-roster giver with no stored row', () => {
    expect(newer([giver('Ana', 1_790_000_000)], new Map())).toBe(true);
  });

  it('same source: true only when the asOf is strictly newer than stored', () => {
    const stored = new Map([['ana', rank('relayed', 1_790_000_000)]]);
    expect(newer([giver('Ana', 1_790_000_001)], stored)).toBe(true);
    expect(newer([giver('Ana', 1_790_000_000)], stored)).toBe(false);
    expect(newer([giver('Ana', 1_789_999_999)], stored)).toBe(false);
  });

  it('equal asOf + newer generatedAt → applicable (write tie-break)', () => {
    const stored = new Map([['ana', rank('relayed', 1_790_000_000)]]);
    const opts = { generatedAt: GEN + 60 };
    expect(newer([giver('Ana', 1_790_000_000)], stored, opts)).toBe(true);
  });

  it('a self giver over a stored relayed row → applicable even when older', () => {
    const stored = new Map([['ana', rank('relayed', 1_790_000_000)]]);
    const asAna = { userId: 2 };
    expect(newer([giver('Ana', 1_789_000_000)], stored, asAna)).toBe(true);
  });

  it('a relayed giver newer than a stored self row → not applicable', () => {
    const stored = new Map([['ana', rank('self', 1_789_000_000)]]);
    expect(newer([giver('Ana', 1_790_000_000)], stored)).toBe(false);
  });

  it('off-roster givers and an exporter off the roster never apply', () => {
    expect(newer([giver('Zed', 1_790_000_000)], new Map())).toBe(false);
    const offRoster = { ...roster, exporterKey: undefined };
    const block = { givers: [giver('Bob', 1_790_000_000)], generatedAt: GEN };
    const input = { block, userId: 1, stored: new Map(), nowMs: NOW_MS };
    expect(anyGiverNewer({ ...input, roster: offRoster })).toBe(false);
  });

  it('clamps a future asOf to now before comparing', () => {
    const stored = new Map([['ana', rank('relayed', NOW_MS / 1000)]]);
    expect(newer([giver('Ana', 1_900_000_000)], stored)).toBe(false);
  });

  it('false with no givers', () => {
    expect(newer([], new Map())).toBe(false);
  });
});

/** The TS twin of the write path's SQL `giverMoves` (moves when >= 0). */
describe('giverPrecedence', () => {
  const r = (
    source: GuildMailworthyGiverSource,
    asOf: number,
    gen: number,
  ) => ({
    source,
    asOf: new Date(asOf),
    generatedAt: new Date(gen),
  });
  it('self always beats relayed; relayed never replaces self', () => {
    expect(
      giverPrecedence(r('self', 1, 1), r('relayed', 9, 9)),
    ).toBeGreaterThan(0);
    expect(giverPrecedence(r('relayed', 9, 9), r('self', 1, 1))).toBeLessThan(
      0,
    );
  });
  it('same source: asOf, then generatedAt, equal is 0', () => {
    expect(giverPrecedence(r('self', 2, 1), r('self', 1, 9))).toBeGreaterThan(
      0,
    );
    expect(giverPrecedence(r('self', 1, 2), r('self', 1, 1))).toBeGreaterThan(
      0,
    );
    expect(giverPrecedence(r('relayed', 1, 1), r('relayed', 1, 1))).toBe(0);
  });
});
