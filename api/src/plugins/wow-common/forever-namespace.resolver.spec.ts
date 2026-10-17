import {
  FOREVER_NAMESPACE_ALIAS,
  getForeverNamespacePrefix,
  resolveBlizzardNamespacePrefix,
  setForeverNamespacePrefix,
} from './forever-namespace.resolver';

describe('forever-namespace.resolver (ROK-1717)', () => {
  afterEach(() => setForeverNamespacePrefix(null));

  it('defaults to the classicforever alias', () => {
    expect(FOREVER_NAMESPACE_ALIAS).toBe('classicforever');
    expect(getForeverNamespacePrefix()).toBe('classicforever');
    expect(resolveBlizzardNamespacePrefix('classicforever')).toBe(
      'classicforever',
    );
  });

  it('resolves the alias to the admin override', () => {
    setForeverNamespacePrefix('foo');
    expect(getForeverNamespacePrefix()).toBe('foo');
    expect(resolveBlizzardNamespacePrefix('classicforever')).toBe('foo');
  });

  it('passes other Classic prefixes through untouched under an override', () => {
    setForeverNamespacePrefix('foo');
    expect(resolveBlizzardNamespacePrefix('classicann')).toBe('classicann');
    expect(resolveBlizzardNamespacePrefix('classic1x')).toBe('classic1x');
  });

  it('keeps null (retail) as null', () => {
    setForeverNamespacePrefix('foo');
    expect(resolveBlizzardNamespacePrefix(null)).toBeNull();
  });

  it('restores the default when reset with null', () => {
    setForeverNamespacePrefix('foo');
    setForeverNamespacePrefix(null);
    expect(resolveBlizzardNamespacePrefix('classicforever')).toBe(
      'classicforever',
    );
  });
});
