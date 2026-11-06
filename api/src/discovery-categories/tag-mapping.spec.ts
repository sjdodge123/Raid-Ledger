import { resolveTagFilter } from './tag-mapping';

describe('resolveTagFilter — Object.prototype member names (backlog 3052)', () => {
  it.each([
    ['constructor', 'constructor'],
    ['__proto__', '__proto__'],
    ['toString', 'tostring'],
  ])(
    'treats the "%s" tag as an unknown descriptor without throwing',
    (tag, substring) => {
      expect(() => resolveTagFilter([tag])).not.toThrow();
      expect(resolveTagFilter([tag])).toEqual({
        itadSubstrings: [substring],
        igdbGenreIds: [],
        igdbThemeIds: [],
      });
    },
  );

  it('still maps a known tag through the synonym and fallback tables', () => {
    expect(resolveTagFilter(['Sci-Fi'])).toEqual({
      itadSubstrings: ['sci-fi', 'science fiction'],
      igdbGenreIds: [],
      igdbThemeIds: [18],
    });
  });
});
