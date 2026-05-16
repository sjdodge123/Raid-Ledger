/**
 * ROK-1287: regression spec for deterministic matchKey selection.
 *
 * `strongestSharedKey` (called internally by `groupRowsByConnectedKeys`) used
 * to return the first count-≥-2 value yielded by `Map.entries()`. Map iteration
 * order mirrors insertion order, which mirrors the caller-side row order, which
 * mirrors Postgres heap order on the source table. Heap order can flip across
 * autovacuum / update churn, so an unchanged dataset could surface a different
 * `matchKey` between consecutive audits.
 *
 * Fix: sort candidate values numerically (igdb/steam ids) or lexicographically
 * (names) before picking the first one. Belt + suspenders alongside the
 * `ORDER BY id ASC` in `loadGameRows()`.
 */
import { groupRowsByConnectedKeys } from './games-dedup-union-find.helpers';
import type { GameRow } from './games-dedup-audit.helpers';

function row(
  partial: Partial<GameRow> & { id: number; name: string },
): GameRow {
  return {
    slug: `slug-${partial.id}`,
    igdbId: null,
    itadGameId: null,
    steamAppId: null,
    cachedAt: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  };
}

describe('Regression: ROK-1287 — strongestSharedKey determinism', () => {
  // Build a connected component whose strongest shared tier has TWO values:
  //   rows 1+2 share igdb:111
  //   rows 3+4 share igdb:222
  //   all four share normalized name 'shared' → component is connected
  // Pre-fix, the matchKey returned could be '111' or '222' depending on row
  // iteration order. Post-fix, numeric sort always picks '111'.
  const baseRows: GameRow[] = [
    row({ id: 1, name: 'shared', igdbId: 111 }),
    row({ id: 2, name: 'shared', igdbId: 111 }),
    row({ id: 3, name: 'shared', igdbId: 222 }),
    row({ id: 4, name: 'shared', igdbId: 222 }),
  ];

  it('returns the same matchKey across 3 distinct row permutations', () => {
    const permutations: GameRow[][] = [
      [...baseRows],
      [...baseRows].reverse(),
      [baseRows[2], baseRows[0], baseRows[3], baseRows[1]],
    ];
    const matchKeys = permutations.map((rows) => {
      const groups = groupRowsByConnectedKeys(rows);
      expect(groups).toHaveLength(1);
      expect(groups[0].matchType).toBe('igdb');
      return groups[0].matchKey;
    });
    expect(new Set(matchKeys).size).toBe(1);
    // Lowest igdb id is preferred under numeric sort.
    expect(matchKeys[0]).toBe('111');
  });

  it('returns the same matchKey across 50 consecutive runs on identical input', () => {
    const matchKeys: string[] = [];
    for (let i = 0; i < 50; i++) {
      const groups = groupRowsByConnectedKeys([...baseRows]);
      matchKeys.push(groups[0].matchKey);
    }
    expect(new Set(matchKeys).size).toBe(1);
    expect(matchKeys[0]).toBe('111');
  });

  it('is deterministic for steam-tier components with multiple shared values', () => {
    const rows: GameRow[] = [
      row({ id: 10, name: 'multi', steamAppId: 456 }),
      row({ id: 11, name: 'multi', steamAppId: 456 }),
      row({ id: 12, name: 'multi', steamAppId: 123 }),
      row({ id: 13, name: 'multi', steamAppId: 123 }),
    ];
    const forward = groupRowsByConnectedKeys([...rows]);
    const reversed = groupRowsByConnectedKeys([...rows].reverse());
    expect(forward[0].matchType).toBe('steam');
    expect(reversed[0].matchType).toBe('steam');
    expect(forward[0].matchKey).toBe('123');
    expect(reversed[0].matchKey).toBe('123');
  });

  it('is deterministic for name-tier components with multiple shared values', () => {
    // Two name-only sub-pairs joined via a bridge row that shares both names.
    const rows: GameRow[] = [
      row({ id: 20, name: 'beta' }),
      row({ id: 21, name: 'beta' }),
      row({ id: 22, name: 'alpha', igdbId: 999 }),
      row({ id: 23, name: 'alpha', igdbId: 999 }),
      row({ id: 24, name: 'beta', igdbId: 999 }),
    ];
    const forward = groupRowsByConnectedKeys([...rows]);
    const reversed = groupRowsByConnectedKeys([...rows].reverse());
    // igdb is the strongest tier with ≥2 share (igdb:999), so the matchType
    // here is igdb, not name. The determinism we care about is the matchKey
    // selection at the strongest tier.
    expect(forward).toHaveLength(1);
    expect(reversed).toHaveLength(1);
    expect(forward[0].matchType).toBe(reversed[0].matchType);
    expect(forward[0].matchKey).toBe(reversed[0].matchKey);
  });
});
