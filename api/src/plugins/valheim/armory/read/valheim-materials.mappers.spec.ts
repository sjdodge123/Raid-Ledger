/** ROK-1853 Codex r1 — the counts converter keeps bigint aggregates exact. */
import {
  parsePrefabFilter,
  toCount,
  toCountsRow,
} from './valheim-materials.mappers';

describe('toCountsRow', () => {
  it('converts bigint strings above the int4 range exactly', () => {
    // 22 chests × 1e8 omitted entries = 2.2e9 > 2^31 - 1.
    expect(
      toCountsRow({
        chestCount: '22',
        unreadable: '0',
        omittedEntries: '2200000000',
      }),
    ).toEqual({ chestCount: 22, unreadable: 0, omittedEntries: 2_200_000_000 });
  });

  it('the worst case the caps allow (4096 × 1e8) stays exact', () => {
    expect(
      toCountsRow({
        chestCount: 4096,
        unreadable: '4096',
        omittedEntries: '409600000000',
      }).omittedEntries,
    ).toBe(409_600_000_000);
  });

  it('no row → all zero', () => {
    expect(toCountsRow(undefined)).toEqual({
      chestCount: 0,
      unreadable: 0,
      omittedEntries: 0,
    });
  });
});

describe('toCount', () => {
  it('refuses a value a double cannot hold exactly', () => {
    expect(() => toCount('9007199254740993')).toThrow(
      'unsafe count: 9007199254740993',
    );
  });
});

describe('parsePrefabFilter (Codex r2 drill-down)', () => {
  it('absent → null; a prefab id passes through', () => {
    expect(parsePrefabFilter(undefined)).toBeNull();
    expect(parsePrefabFilter('SwordIron')).toBe('SwordIron');
  });

  it('a malformed or repeated value is a 400', () => {
    expect(() => parsePrefabFilter('no way')).toThrow('Invalid prefab');
    expect(() => parsePrefabFilter(['Wood', 'Stone'])).toThrow(
      'Invalid prefab',
    );
    expect(() => parsePrefabFilter('')).toThrow('Invalid prefab');
  });
});
