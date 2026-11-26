import { provenanceRank, shouldRaise } from './provenance';

describe('provenanceRank (L5)', () => {
  it.each([
    ['steam', 2],
    ['igdb', 1],
    ['itad', 1],
    ['wikidata', 1],
    ['manual', 1],
    ['unknown', 1],
  ] as const)('%s ranks %i', (p, rank) => {
    expect(provenanceRank(p)).toBe(rank);
  });

  it('NULL ranks 0', () => {
    expect(provenanceRank(null)).toBe(0);
  });
});

describe('shouldRaise', () => {
  it('steam replaces any other stored value', () => {
    expect(shouldRaise('igdb', 'steam')).toBe(true);
    expect(shouldRaise('unknown', 'steam')).toBe(true);
    expect(shouldRaise(null, 'igdb')).toBe(true);
  });

  it('nothing replaces steam, and equal rank keeps the first (Q2)', () => {
    expect(shouldRaise('steam', 'igdb')).toBe(false);
    expect(shouldRaise('steam', 'steam')).toBe(false);
    expect(shouldRaise('unknown', 'igdb')).toBe(false);
    expect(shouldRaise('igdb', null)).toBe(false);
  });
});
