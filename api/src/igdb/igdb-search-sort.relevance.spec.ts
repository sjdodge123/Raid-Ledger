/**
 * ROK-1602 — pure ranking for the web game search (`/games/search`).
 *
 * Prod: typing "wow" put "Wow Dance" / "Wowo Island" above every World of
 * Warcraft title, because a plain `startsWith` scored them as prefix hits while
 * "World of Warcraft" (surfaced by IGDB/ITAD alternative names) scored nothing.
 */
import {
  compareSearchRank,
  computeRelevance,
} from './igdb-search-sort.helpers';

describe('computeRelevance (ROK-1602 tiers)', () => {
  it('scores an exact name above an exact acronym', () => {
    expect(computeRelevance('WOW', 'wow')).toBeGreaterThan(
      computeRelevance('World of Warcraft', 'wow'),
    );
  });

  it('scores an exact acronym above a leading-word match', () => {
    expect(computeRelevance('World of Warcraft', 'wow')).toBeGreaterThan(
      computeRelevance('Wow Dance', 'wow'),
    );
  });

  it('scores acronym-prefix and leading-word matches in the same tier', () => {
    expect(computeRelevance('World of Warcraft Classic', 'wow')).toBe(
      computeRelevance('WoW: Forever', 'wow'),
    );
  });

  it('scores a leading-word match above a bare prefix', () => {
    expect(computeRelevance('Wow Dance', 'wow')).toBeGreaterThan(
      computeRelevance('Wowo Island', 'wow'),
    );
  });

  it('scores a bare prefix above an infix, and infix above no match', () => {
    expect(computeRelevance('Wowo Island', 'wow')).toBeGreaterThan(
      computeRelevance('Snowowl', 'wow'),
    );
    expect(computeRelevance('Snowowl', 'wow')).toBeGreaterThan(
      computeRelevance('Azeroth Chronicles', 'wow'),
    );
  });

  it('matches exactly across punctuation', () => {
    expect(computeRelevance("Baldur's Gate 3", 'baldurs gate 3')).toBe(
      computeRelevance('Baldurs Gate 3', 'baldurs gate 3'),
    );
  });

  it('does not acronym-match short or digit-bearing queries', () => {
    expect(computeRelevance('Grand Theft', 'gt')).toBe(1);
    expect(computeRelevance('Baldurs Gate 3', 'bg3')).toBe(1);
  });
});

describe('compareSearchRank', () => {
  const rank = (
    games: Array<{ id: number; name: string; popularity: number | null }>,
    interest: Map<number, number> = new Map(),
  ): string[] =>
    [...games]
      .sort((a, b) => compareSearchRank(a, b, 'wow', interest))
      .map((g) => g.name);

  it('puts the World of Warcraft titles above Wow Dance / Wowo Island', () => {
    expect(
      rank([
        { id: 1, name: 'Wowo Island', popularity: 2 },
        { id: 2, name: 'Wow Dance', popularity: 3 },
        { id: 3, name: 'WoW: Forever', popularity: 40 },
        { id: 4, name: 'World of Warcraft Classic', popularity: 80 },
        { id: 5, name: 'World of Warcraft', popularity: 95 },
      ]),
    ).toEqual([
      'World of Warcraft',
      'World of Warcraft Classic',
      'WoW: Forever',
      'Wow Dance',
      'Wowo Island',
    ]);
  });

  it('breaks ties by popularity (nulls last) before name length', () => {
    expect(
      rank([
        { id: 1, name: 'Wow A', popularity: null },
        { id: 2, name: 'Wow Longer Name', popularity: 10 },
      ]),
    ).toEqual(['Wow Longer Name', 'Wow A']);
  });

  it('then by interest count, then shorter name, then alphabetical', () => {
    const interest = new Map([[2, 5]]);
    expect(
      rank(
        [
          { id: 1, name: 'Wow Bb', popularity: null },
          { id: 2, name: 'Wow Cccc', popularity: null },
          { id: 3, name: 'Wow Ab', popularity: null },
        ],
        interest,
      ),
    ).toEqual(['Wow Cccc', 'Wow Ab', 'Wow Bb']);
  });
});
