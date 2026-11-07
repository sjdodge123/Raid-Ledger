import {
  FOREVER_DEFAULT_PREFIX,
  FOREVER_NAMESPACE_ALIAS,
  getForeverNamespacePrefix,
  resolveBlizzardNamespacePrefix,
  setForeverNamespacePrefix,
} from './forever-namespace.resolver';

describe('forever-namespace.resolver (ROK-1717, ROK-2102)', () => {
  afterEach(() => setForeverNamespacePrefix(null));

  it('resolves the classicforever alias to the forever default with no override', () => {
    expect(FOREVER_NAMESPACE_ALIAS).toBe('classicforever');
    expect(FOREVER_DEFAULT_PREFIX).toBe('forever');
    expect(getForeverNamespacePrefix()).toBe('forever');
    expect(resolveBlizzardNamespacePrefix('classicforever')).toBe('forever');
  });

  it('resolves the alias to the admin override', () => {
    setForeverNamespacePrefix('xyz');
    expect(getForeverNamespacePrefix()).toBe('xyz');
    expect(resolveBlizzardNamespacePrefix('classicforever')).toBe('xyz');
  });

  it('passes other Classic prefixes through untouched under an override', () => {
    setForeverNamespacePrefix('xyz');
    expect(resolveBlizzardNamespacePrefix('classicann')).toBe('classicann');
    expect(resolveBlizzardNamespacePrefix('classic1x')).toBe('classic1x');
  });

  it('passes Classic prefixes and null (retail) through with no override', () => {
    expect(resolveBlizzardNamespacePrefix('classicann')).toBe('classicann');
    expect(resolveBlizzardNamespacePrefix('classic1x')).toBe('classic1x');
    expect(resolveBlizzardNamespacePrefix(null)).toBeNull();
  });

  it('keeps null (retail) as null under an override', () => {
    setForeverNamespacePrefix('xyz');
    expect(resolveBlizzardNamespacePrefix(null)).toBeNull();
  });

  it.each([null, ''])(
    'restores the forever default when reset with %p',
    (reset) => {
      setForeverNamespacePrefix('xyz');
      setForeverNamespacePrefix(reset);
      expect(resolveBlizzardNamespacePrefix('classicforever')).toBe('forever');
    },
  );

  it('never resolves the alias to itself, even when set to the alias', () => {
    setForeverNamespacePrefix('classicforever');
    expect(getForeverNamespacePrefix()).toBe('forever');
  });
});
