/**
 * buildSchedulingHero — standalone sub-line copy + creator attribution.
 *
 * Sub-line: pins the open-roster phrasing ("N people in this poll", not
 * "You invited N members") and its singular/plural branch. Added with the
 * voter-membership fix: voters self-enroll as members, so the member count
 * includes people the creator never explicitly invited.
 *
 * Badge (ROK-1496): the standalone badge used to be the literal
 * "started by you" for every viewer. It must name the actual creator, say
 * "you" only when the viewer IS the creator, and omit attribution when the
 * creator cannot be resolved from the DTO.
 */
import { describe, it, expect } from 'vitest';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { buildSchedulingHero, resolvePollCreator } from '../scheduling-hero';
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
    creatorDisplayName: null,
    viewerIsCreator: false,
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

describe('buildSchedulingHero — standalone badge (ROK-1496)', () => {
  it('names the creator when the viewer is not the creator', () => {
    const hero = buildSchedulingHero(
      standaloneInput({ creatorDisplayName: 'hiptoptobop', viewerIsCreator: false }),
    );
    expect(hero.badge).toBe('🗓 Scheduling Poll · started by hiptoptobop');
  });

  it('says "you" only when the viewer is the creator', () => {
    const hero = buildSchedulingHero(
      standaloneInput({ creatorDisplayName: 'Me', viewerIsCreator: true }),
    );
    expect(hero.badge).toBe('🗓 Scheduling Poll · started by you');
  });

  it('omits attribution when the creator cannot be resolved', () => {
    const hero = buildSchedulingHero(
      standaloneInput({ creatorDisplayName: null, viewerIsCreator: false }),
    );
    expect(hero.badge).toBe('🗓 Scheduling Poll');
    expect(hero.badge).not.toContain('you');
  });

  it('from-match badge is unaffected', () => {
    const hero = buildSchedulingHero(
      standaloneInput({ mode: 'from-match', viewerIsCreator: false }),
    );
    expect(hero.badge).toBe('Step 4 of 4 · Scheduling');
  });
});

type CreatorMatch = Pick<MatchDetailResponseDto, 'lineupCreatedById' | 'members'>;

function member(
  userId: number,
  displayName: string,
): MatchDetailResponseDto['members'][number] {
  return {
    id: userId * 10,
    matchId: 500,
    userId,
    source: 'voted',
    createdAt: '2026-05-15T00:00:00.000Z',
    displayName,
    avatar: null,
    discordId: null,
    customAvatarUrl: null,
    schedulingSubmittedAt: null,
  };
}

function creatorMatch(
  lineupCreatedById: number | undefined,
  members = [member(99, 'Me'), member(2, 'hiptoptobop')],
): CreatorMatch {
  return { lineupCreatedById, members };
}

describe('resolvePollCreator', () => {
  it('resolves the creator name from members when the viewer is someone else', () => {
    expect(resolvePollCreator(creatorMatch(2), 99)).toEqual({
      creatorDisplayName: 'hiptoptobop',
      viewerIsCreator: false,
    });
  });

  it('flags the viewer as creator when ids match', () => {
    expect(resolvePollCreator(creatorMatch(99), 99)).toEqual({
      creatorDisplayName: 'Me',
      viewerIsCreator: true,
    });
  });

  it('returns null name / false when lineupCreatedById is absent', () => {
    expect(resolvePollCreator(creatorMatch(undefined), 99)).toEqual({
      creatorDisplayName: null,
      viewerIsCreator: false,
    });
  });

  it('returns a null name when the creator is not among the members', () => {
    expect(resolvePollCreator(creatorMatch(1), 99)).toEqual({
      creatorDisplayName: null,
      viewerIsCreator: false,
    });
  });

  it('still names the creator for an anonymous viewer', () => {
    expect(resolvePollCreator(creatorMatch(2), null)).toEqual({
      creatorDisplayName: 'hiptoptobop',
      viewerIsCreator: false,
    });
  });
});
