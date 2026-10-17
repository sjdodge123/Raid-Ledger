/**
 * ROK-788: Tests for GameRegistrySchema apiNamespacePrefix field.
 * Validates that the contract schema correctly handles the new nullable
 * field for Blizzard API namespace resolution.
 */
import { GameRegistrySchema } from '@raid-ledger/contract';

const BASE_GAME = {
  id: 1,
  slug: 'world-of-warcraft',
  name: 'World of Warcraft',
  shortName: 'WoW',
  coverUrl: null,
  colorHex: '#F58518',
  hasRoles: true,
  hasSpecs: true,
  enabled: true,
  maxCharactersPerUser: 10,
  genres: [12, 31],
};

describe('GameRegistrySchema — apiNamespacePrefix (ROK-788)', () => {
  it('accepts null for retail WoW (default namespace)', () => {
    const result = GameRegistrySchema.parse({
      ...BASE_GAME,
      apiNamespacePrefix: null,
    });
    expect(result.apiNamespacePrefix).toBeNull();
  });

  it('accepts classic1x for Classic Era', () => {
    const result = GameRegistrySchema.parse({
      ...BASE_GAME,
      slug: 'world-of-warcraft-classic',
      name: 'World of Warcraft Classic Era',
      apiNamespacePrefix: 'classic1x',
    });
    expect(result.apiNamespacePrefix).toBe('classic1x');
  });

  it('accepts classicann for TBC Anniversary', () => {
    const result = GameRegistrySchema.parse({
      ...BASE_GAME,
      slug: 'wow-tbc-ann',
      name: 'WoW TBC Anniversary',
      apiNamespacePrefix: 'classicann',
    });
    expect(result.apiNamespacePrefix).toBe('classicann');
  });

  it('accepts classic for Wrath/TBC', () => {
    const result = GameRegistrySchema.parse({
      ...BASE_GAME,
      slug: 'wow-wrath',
      name: 'WoW Wrath',
      apiNamespacePrefix: 'classic',
    });
    expect(result.apiNamespacePrefix).toBe('classic');
  });

  it('defaults to undefined when field is omitted', () => {
    const result = GameRegistrySchema.parse(BASE_GAME);
    expect(result.apiNamespacePrefix).toBeUndefined();
  });

  it('rejects non-string values', () => {
    expect(() =>
      GameRegistrySchema.parse({
        ...BASE_GAME,
        apiNamespacePrefix: 123,
      }),
    ).toThrow();
  });
});
