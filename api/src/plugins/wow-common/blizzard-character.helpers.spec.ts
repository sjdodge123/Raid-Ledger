import { buildCharacterParams } from './blizzard-character.helpers';

describe('buildCharacterParams', () => {
  it('should build retail params with null apiNamespacePrefix', () => {
    const result = buildCharacterParams('Thrall', 'Area 52', 'us', null);
    expect(result).toEqual({
      realmSlug: 'area-52',
      charName: 'thrall',
      namespace: 'profile-us',
      baseUrl: 'https://us.api.blizzard.com',
    });
  });

  it('should build classic params with classic1x prefix', () => {
    const result = buildCharacterParams(
      'Jaina',
      'Grobbulus',
      'us',
      'classic1x',
    );
    expect(result).toEqual({
      realmSlug: 'grobbulus',
      charName: 'jaina',
      namespace: 'profile-classic1x-us',
      baseUrl: 'https://us.api.blizzard.com',
    });
  });

  it('should strip apostrophes and spaces from realm name', () => {
    const result = buildCharacterParams('Test', "Quel'Thalas", 'eu', null);
    expect(result.realmSlug).toBe('quelthalas');
  });

  it('should build classicann params correctly', () => {
    const result = buildCharacterParams('Char', 'Faerlina', 'us', 'classicann');
    expect(result.namespace).toBe('profile-classicann-us');
  });
});
