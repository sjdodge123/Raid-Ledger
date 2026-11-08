/**
 * ROK-2107: the manual-vs-Armory professions switch and the effective value.
 */
import {
  MANUAL_PROFESSIONS_WIN,
  effectiveProfessions,
  parseProfessions,
} from './characters-professions.helpers';

function profs(name: string) {
  return {
    primary: [
      {
        id: 1,
        name,
        slug: name.toLowerCase(),
        skillLevel: 100,
        maxSkillLevel: 300,
        tiers: [],
      },
    ],
    secondary: [],
    syncedAt: '2026-11-06T00:00:00.000Z',
  };
}

const MANUAL = profs('Tailoring');
const ARMORY = profs('Mining');

describe('MANUAL_PROFESSIONS_WIN (operator ruling F0)', () => {
  it('defaults to Blizzard beating manual (ruling 2026-11-07)', () => {
    expect(MANUAL_PROFESSIONS_WIN).toBe(false);
  });
});

describe('effectiveProfessions', () => {
  it('returns null/null when neither column has data', () => {
    expect(effectiveProfessions(null, null)).toEqual({
      value: null,
      source: null,
    });
  });

  it('returns the manual value when only manual exists', () => {
    expect(effectiveProfessions(MANUAL, null)).toEqual({
      value: MANUAL,
      source: 'manual',
    });
  });

  it('returns the Armory value when only Armory exists', () => {
    expect(effectiveProfessions(null, ARMORY)).toEqual({
      value: ARMORY,
      source: 'blizzard',
    });
  });

  it('Armory beats manual under the default switch; manual is the fallback', () => {
    expect(effectiveProfessions(MANUAL, ARMORY)).toEqual({
      value: ARMORY,
      source: 'blizzard',
    });
    expect(effectiveProfessions(MANUAL, null)).toEqual({
      value: MANUAL,
      source: 'manual',
    });
  });

  it('manual beats Armory when the switch is flipped back', () => {
    expect(effectiveProfessions(MANUAL, ARMORY, true)).toEqual({
      value: MANUAL,
      source: 'manual',
    });
  });

  // ROK-2138 AC-P1: the pick is age-blind — a months-old Armory sync still
  // beats a hand entry; the hand entry only fills a missing Armory value.
  it('Armory beats manual however old its syncedAt (AC-P1)', () => {
    const old = { ...ARMORY, syncedAt: '2025-01-01T00:00:00.000Z' };
    expect(effectiveProfessions(MANUAL, old)).toEqual({
      value: old,
      source: 'blizzard',
    });
  });

  it('ignores a malformed Armory jsonb and falls back to manual', () => {
    expect(effectiveProfessions(MANUAL, { primary: 'nope' })).toEqual({
      value: MANUAL,
      source: 'manual',
    });
  });

  it('ignores a malformed manual jsonb and falls back to Armory', () => {
    expect(effectiveProfessions({ primary: 'nope' }, ARMORY)).toEqual({
      value: ARMORY,
      source: 'blizzard',
    });
  });
});

describe('parseProfessions', () => {
  it('treats undefined, null and malformed values as absent', () => {
    expect(parseProfessions(undefined)).toBeNull();
    expect(parseProfessions(null)).toBeNull();
    expect(parseProfessions({ primary: [] })).toBeNull();
  });
});
