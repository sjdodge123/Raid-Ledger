/**
 * ROK-2148 review r1 — the multi-row Mailworthy upserts lock rows in
 * `nameKey` order, so overlapping concurrent imports cannot deadlock.
 */
import { sortByNameKey } from './addon-import-char.mailworthy.helpers';

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
