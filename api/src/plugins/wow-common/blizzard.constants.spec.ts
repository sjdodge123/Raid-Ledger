import {
  getNamespacePrefixes,
  variantToNamespacePrefix,
  WOW_FOREVER_NAMESPACE_PREFIX,
} from './blizzard.constants';

describe('getNamespacePrefixes', () => {
  it('should return bare prefixes when apiNamespacePrefix is null (retail)', () => {
    const result = getNamespacePrefixes(null);
    expect(result).toEqual({
      static: 'static',
      dynamic: 'dynamic',
      profile: 'profile',
    });
  });

  it('should prepend classic1x prefix with hyphen', () => {
    const result = getNamespacePrefixes('classic1x');
    expect(result).toEqual({
      static: 'static-classic1x',
      dynamic: 'dynamic-classic1x',
      profile: 'profile-classic1x',
    });
  });

  it('should prepend classicann prefix with hyphen', () => {
    const result = getNamespacePrefixes('classicann');
    expect(result).toEqual({
      static: 'static-classicann',
      dynamic: 'dynamic-classicann',
      profile: 'profile-classicann',
    });
  });

  it('should prepend classic prefix with hyphen', () => {
    const result = getNamespacePrefixes('classic');
    expect(result).toEqual({
      static: 'static-classic',
      dynamic: 'dynamic-classic',
      profile: 'profile-classic',
    });
  });

  it('should handle arbitrary prefix strings', () => {
    const result = getNamespacePrefixes('somefuture');
    expect(result).toEqual({
      static: 'static-somefuture',
      dynamic: 'dynamic-somefuture',
      profile: 'profile-somefuture',
    });
  });
});

/** ROK-1563: WoW: Forever variant wiring (namespace still a placeholder). */
describe('wow_forever variant (ROK-1563)', () => {
  it('maps the variant to the placeholder Forever namespace prefix', () => {
    expect(variantToNamespacePrefix('wow_forever')).toBe(
      WOW_FOREVER_NAMESPACE_PREFIX,
    );
  });

  it('never maps wow_forever to retail (null would read live data)', () => {
    expect(variantToNamespacePrefix('wow_forever')).not.toBeNull();
  });

  it('builds static-/dynamic-/profile- prefixes for the Forever namespace', () => {
    expect(getNamespacePrefixes(WOW_FOREVER_NAMESPACE_PREFIX)).toEqual({
      static: 'static-classicforever',
      dynamic: 'dynamic-classicforever',
      profile: 'profile-classicforever',
    });
  });

  it('leaves the four existing variants untouched (AC4)', () => {
    expect(variantToNamespacePrefix('retail')).toBeNull();
    expect(variantToNamespacePrefix('classic_era')).toBe('classic1x');
    expect(variantToNamespacePrefix('classic')).toBe('classic');
    expect(variantToNamespacePrefix('classic_anniversary')).toBe('classicann');
  });
});
