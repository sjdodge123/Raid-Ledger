import { getNamespacePrefixes } from './blizzard.constants';

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
