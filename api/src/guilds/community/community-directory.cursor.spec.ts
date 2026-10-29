import {
  decodeCursor,
  encodeCursor,
  parseMembersKey,
} from './community-directory.cursor';

describe('directory cursor (ROK-1870 M12)', () => {
  it('round-trips', () => {
    const c = { s: 'name' as const, v: 'bg3 crew', id: 4 };
    expect(decodeCursor(encodeCursor(c), 'name')).toEqual(c);
  });

  it('is absent without a cursor', () => {
    expect(decodeCursor(undefined, 'members')).toBeNull();
  });

  it('400s a forged or cross-sort cursor', () => {
    expect(() => decodeCursor('not-json!', 'members')).toThrow(
      'Invalid cursor',
    );
    const named = encodeCursor({ s: 'name', v: 'x', id: 1 });
    expect(() => decodeCursor(named, 'members')).toThrow('Invalid cursor');
  });

  // TECH-DEBT 2026-10-23 (ROK-1943 Codex r5 P3): the keys are bound as
  // `::int`, so an out-of-int4 value reached Postgres and 500'd. MUTATION:
  // drop `.max(INT4_MAX)` / the range check and these stop throwing.
  it('400s a row id outside int4', () => {
    const big = encodeCursor({ s: 'name', v: 'x', id: 2147483648 });
    expect(() => decodeCursor(big, 'name')).toThrow('Invalid cursor');
    const max = { s: 'name' as const, v: 'x', id: 2147483647 };
    expect(decodeCursor(encodeCursor(max), 'name')).toEqual(max);
  });

  it('400s a member-count key that is not an int4', () => {
    for (const v of ['2147483648', '-1', '1.5', 'abc', '1e300']) {
      expect(() => parseMembersKey(v)).toThrow('Invalid cursor');
    }
    expect(parseMembersKey('2147483647')).toBe(2147483647);
    expect(parseMembersKey('0')).toBe(0);
  });
});
