/**
 * ROK-2148 review r1 — the multi-row Mailworthy upserts lock rows in
 * `nameKey` order, so overlapping concurrent imports cannot deadlock.
 */
import {
  MAX_ITEMS_ALL_TIME,
  clampGiver,
  sortByNameKey,
} from './addon-import-char.mailworthy.helpers';

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
