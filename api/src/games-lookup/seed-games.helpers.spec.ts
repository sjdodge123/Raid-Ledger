import { buildSeedGameUpdateSet } from './seed-games.helpers';

describe('buildSeedGameUpdateSet', () => {
  const base = {
    name: 'Some Game',
    shortName: null,
    colorHex: '#112233',
    hasRoles: false,
    hasSpecs: false,
    maxCharactersPerUser: 1,
  };

  it('heals coverUrl for the chao-chao entry (ROK-1410)', () => {
    const set = buildSeedGameUpdateSet({
      ...base,
      slug: 'chao-chao',
      name: 'Chao Chao',
      coverUrl: '/game-covers/chao-chao-cover.jpg',
      websiteUrl: 'https://chaochaogame.com',
      isFreeToPlay: true,
    });
    expect(set.coverUrl).toBe('/game-covers/chao-chao-cover.jpg');
    expect(set.websiteUrl).toBe('https://chaochaogame.com');
    expect(set.isFreeToPlay).toBe(true);
  });

  it('never includes coverUrl for any other slug, even when the seed carries one', () => {
    const set = buildSeedGameUpdateSet({
      ...base,
      slug: 'world-of-warcraft',
      coverUrl: '/game-covers/anything.jpg',
    });
    expect('coverUrl' in set).toBe(false);
  });

  it('omits igdbId when absent and passes config columns through', () => {
    const set = buildSeedGameUpdateSet({ ...base, slug: 'custom' });
    expect('igdbId' in set).toBe(false);
    expect('websiteUrl' in set).toBe(false);
    expect(set.colorHex).toBe('#112233');
    expect(set.maxCharactersPerUser).toBe(1);
  });

  it('includes igdbId when present', () => {
    const set = buildSeedGameUpdateSet({ ...base, slug: 'wow', igdbId: 123 });
    expect(set.igdbId).toBe(123);
  });
});
