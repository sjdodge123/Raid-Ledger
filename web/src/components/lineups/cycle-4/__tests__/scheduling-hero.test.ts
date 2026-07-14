/**
 * buildSchedulingHero — standalone sub-line copy.
 *
 * Pins the open-roster phrasing ("N people in this poll", not
 * "You invited N members") and its singular/plural branch. Added with the
 * voter-membership fix: voters self-enroll as members, so the member count
 * includes people the creator never explicitly invited.
 */
import { describe, it, expect } from 'vitest';
import { buildSchedulingHero } from '../scheduling-hero';
import type { SchedulingHeroInput } from '../scheduling-hero';

function standaloneInput(
  overrides: Partial<SchedulingHeroInput>,
): SchedulingHeroInput {
  return {
    mode: 'standalone',
    submitted: false,
    gameName: 'Valheim',
    uniqueVoterCount: 0,
    memberCount: 1,
    crossRefs: null,
    ...overrides,
  };
}

describe('buildSchedulingHero — standalone sub-line', () => {
  it('uses singular "person" for a lone creator', () => {
    const hero = buildSchedulingHero(standaloneInput({}));
    expect(hero.sub).toBe(
      '1 person in this poll · 0 of 1 have voted on times so far',
    );
  });

  it('uses plural "people" and never says "invited"', () => {
    const hero = buildSchedulingHero(
      standaloneInput({ memberCount: 4, uniqueVoterCount: 3 }),
    );
    expect(hero.sub).toBe(
      '4 people in this poll · 3 of 4 have voted on times so far',
    );
    expect(hero.sub).not.toContain('invited');
  });
});
