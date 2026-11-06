import { describe, it, expect } from 'vitest';
import { getClassIconUrl } from './class-icons';
import { getProfessionIconUrl } from './profession-icons';
import { getRoleIconUrl } from './role-icons';
import { foreverTreeNames } from './forever-talent-trees';

const PROTOTYPE_KEYS = ['constructor', 'toString', '__proto__'];

describe('WoW lookup tables ignore prototype members', () => {
  it.each(PROTOTYPE_KEYS)('getClassIconUrl(%s) is null', (key) => {
    expect(getClassIconUrl(key)).toBeNull();
  });

  it.each(PROTOTYPE_KEYS)('getProfessionIconUrl(%s) is null', (key) => {
    expect(getProfessionIconUrl(key)).toBeNull();
  });

  it.each(PROTOTYPE_KEYS)('getRoleIconUrl(%s) is null', (key) => {
    expect(getRoleIconUrl(key)).toBeNull();
  });

  it.each(PROTOTYPE_KEYS)('foreverTreeNames(%s) falls back to Tree 1/2/3', (key) => {
    expect(foreverTreeNames(key)).toEqual(['Tree 1', 'Tree 2', 'Tree 3']);
  });

  it('still resolves real keys', () => {
    expect(getClassIconUrl('Warrior')).toMatch(/classicon_warrior\.jpg$/);
    expect(getRoleIconUrl('tank')).toBe('/icons/roles/tank.png');
    expect(getProfessionIconUrl('alchemy')).toMatch(/^https?:\/\//);
    expect(foreverTreeNames('Mage')).toEqual(['Arcane', 'Fire', 'Frost']);
  });
});
