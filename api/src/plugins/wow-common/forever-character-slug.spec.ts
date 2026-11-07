import { buildForeverCharacterSlug } from './forever-character-slug';

describe('buildForeverCharacterSlug (ROK-2102)', () => {
  it('joins the two parts with a hyphen, lowercased', () => {
    expect(buildForeverCharacterSlug('Ana Forever')).toBe('ana-forever');
  });

  it('trims outer whitespace like the contract', () => {
    expect(buildForeverCharacterSlug('  Ana Forever ')).toBe('ana-forever');
  });

  it('rejects a double inner space like the contract', () => {
    expect(() => buildForeverCharacterSlug('  ANA   Forever ')).toThrow(
      'Not a two-part Forever name',
    );
  });

  it('percent-encodes non-ASCII letters as UTF-8 bytes', () => {
    expect(buildForeverCharacterSlug('Zoë Ångström')).toBe(
      'zo%C3%AB-%C3%A5ngstr%C3%B6m',
    );
  });

  it.each([
    ['a single word', 'Ana'],
    ['three words', 'Ana Forever More'],
    ['a digit', 'Ana F0rever'],
    ['a path traversal', '../x'],
    ['a slash', 'a/b'],
    ['a slash inside a part', 'Ana Fore/ver'],
  ])('rejects %s', (_label, input) => {
    expect(() => buildForeverCharacterSlug(input)).toThrow(
      'Not a two-part Forever name',
    );
  });

  it('lowercases without locale rules (İ keeps its combining dot)', () => {
    expect(buildForeverCharacterSlug('İlse Forever')).toBe(
      encodeURIComponent('İlse'.toLowerCase() + '-forever'),
    );
    expect(buildForeverCharacterSlug('İlse Forever')).toBe(
      'i%CC%87lse-forever',
    );
  });
});
