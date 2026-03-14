/**
 * Tests for embed-sync.helpers.ts — character class fallback resolution (ROK-824).
 *
 * Verifies that resolveCharacterClass resolves character class for users
 * with null characterId but valid userId, by falling back to the
 * user's main character.
 */
import * as helpers from './embed-sync.helpers';

describe('resolveCharacterClass', () => {
  it('returns class name when characterId is present', () => {
    const result = helpers.resolveCharacterClass({
      characterClass: 'Mage',
      userId: 1,
      mainCharacterClass: null,
    });
    expect(result).toBe('Mage');
  });

  it('falls back to main character class when characterId is null', () => {
    const result = helpers.resolveCharacterClass({
      characterClass: null,
      userId: 1,
      mainCharacterClass: 'Rogue',
    });
    expect(result).toBe('Rogue');
  });

  it('returns null when both characterId and main character are null', () => {
    const result = helpers.resolveCharacterClass({
      characterClass: null,
      userId: 1,
      mainCharacterClass: null,
    });
    expect(result).toBeNull();
  });

  it('returns null when userId is null (anonymous signup)', () => {
    const result = helpers.resolveCharacterClass({
      characterClass: null,
      userId: null,
      mainCharacterClass: null,
    });
    expect(result).toBeNull();
  });
});
