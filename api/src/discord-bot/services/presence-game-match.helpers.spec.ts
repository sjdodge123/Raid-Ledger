import {
  pickNormalizedTitleMatch,
  TRIGRAM_CANDIDATE_LIMIT,
} from './presence-game-match.helpers';

describe('presence-game-match.helpers (ROK-1504)', () => {
  it('exposes a top-N candidate limit greater than 1', () => {
    expect(TRIGRAM_CANDIDATE_LIMIT).toBeGreaterThan(1);
  });

  it('rejects "Revenge of the Mage" for activity "Revenge of the Titans"', () => {
    const result = pickNormalizedTitleMatch('Revenge of the Titans', [
      { id: 77, name: 'Revenge of the Mage' },
    ]);
    expect(result).toBeNull();
  });

  it('accepts a candidate differing only by ®/™/colon/roman numeral', () => {
    const cod = { id: 40, name: 'Call of Duty: Modern Warfare 2' };
    const result = pickNormalizedTitleMatch(
      'Call of Duty®: Modern Warfare® II',
      [cod],
    );
    expect(result).toBe(cod);
  });

  it('returns the first acceptable candidate in similarity order', () => {
    const a = { id: 1, name: 'Revenge of the Titans™' };
    const b = { id: 2, name: 'Revenge of the Titans' };
    expect(pickNormalizedTitleMatch('Revenge of the Titans', [a, b])).toBe(a);

    const wrongFirst = { id: 77, name: 'Revenge of the Mage' };
    expect(
      pickNormalizedTitleMatch('Revenge of the Titans', [wrongFirst, b]),
    ).toBe(b);
  });

  it('returns null for empty candidates', () => {
    expect(pickNormalizedTitleMatch('Anything', [])).toBeNull();
  });

  it('does not accept a prefix/superset title', () => {
    expect(
      pickNormalizedTitleMatch('Counter-Strike', [
        { id: 3, name: 'Counter-Strike 2' },
      ]),
    ).toBeNull();
    expect(
      pickNormalizedTitleMatch('Counter-Strike 2', [
        { id: 4, name: 'Counter-Strike' },
      ]),
    ).toBeNull();
  });
});
