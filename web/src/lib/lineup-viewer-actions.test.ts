/**
 * lineup-viewer-actions tests (ROK-1296, AC3).
 *
 * Closes the chain: DTO `viewerSubmissions` field → `UserActions` partial
 * → `getHeroState` tone flip from `action` → `waiting`. Composite stories
 * will compose this output into the full `UserActions` they pass to
 * `<JourneyHero />`.
 */
import { describe, it, expect } from 'vitest';
import { getHeroState } from '../components/shared/journey-hero/get-hero-state';
import type {
  GroupProgress,
  LineupConfig,
  UserActions,
} from '../components/shared/journey-hero/types';
import { mapViewerSubmissionsToUserActions } from './lineup-viewer-actions';
import { createMockLineupDetail } from '../test/lineup-factories';

const groupProgress: GroupProgress = {
  nominationsSubmitted: 0,
  votesSubmitted: 0,
  totalVoters: 5,
};

const lineupConfig: LineupConfig = {
  nominationQuorum: 4,
  votingQuorum: 3,
  schedulingAgreementPct: 50,
};

function fullUserActions(partial: Partial<UserActions>): UserActions {
  return {
    hasSubmittedNominations: false,
    hasSubmittedVotes: false,
    scheduledMatchCount: 0,
    totalMatchCount: 0,
    ...partial,
  };
}

describe('mapViewerSubmissionsToUserActions', () => {
  it('returns both false when both timestamps are null (viewer has submitted nothing)', () => {
    const lineup = createMockLineupDetail({
      viewerSubmissions: {
        nominationsSubmittedAt: null,
        votesSubmittedAt: null,
      },
    });

    expect(mapViewerSubmissionsToUserActions(lineup)).toEqual({
      hasSubmittedNominations: false,
      hasSubmittedVotes: false,
    });
  });

  it('returns hasSubmittedNominations=true when nominationsSubmittedAt is a non-null ISO string', () => {
    const lineup = createMockLineupDetail({
      viewerSubmissions: {
        nominationsSubmittedAt: '2026-05-17T00:00:00Z',
        votesSubmittedAt: null,
      },
    });

    expect(mapViewerSubmissionsToUserActions(lineup)).toEqual({
      hasSubmittedNominations: true,
      hasSubmittedVotes: false,
    });
  });

  it('returns hasSubmittedVotes=true when votesSubmittedAt is a non-null ISO string', () => {
    const lineup = createMockLineupDetail({
      viewerSubmissions: {
        nominationsSubmittedAt: '2026-05-17T00:00:00Z',
        votesSubmittedAt: '2026-05-17T01:00:00Z',
      },
    });

    expect(mapViewerSubmissionsToUserActions(lineup)).toEqual({
      hasSubmittedNominations: true,
      hasSubmittedVotes: true,
    });
  });
});

describe('AC3 chain — viewerSubmissions → getHeroState tone flip', () => {
  it('returns tone=action while nominationsSubmittedAt is null in nominating phase', () => {
    const lineup = createMockLineupDetail({
      viewerSubmissions: {
        nominationsSubmittedAt: null,
        votesSubmittedAt: null,
      },
    });

    const userActions = fullUserActions(
      mapViewerSubmissionsToUserActions(lineup),
    );
    const hero = getHeroState({
      phase: 'nominating',
      userActions,
      groupProgress,
      lineupConfig,
    });

    expect(hero.tone).toBe('action');
  });

  it('flips to tone=waiting once nominationsSubmittedAt is non-null', () => {
    const lineup = createMockLineupDetail({
      viewerSubmissions: {
        nominationsSubmittedAt: '2026-05-17T00:00:00Z',
        votesSubmittedAt: null,
      },
    });

    const userActions = fullUserActions(
      mapViewerSubmissionsToUserActions(lineup),
    );
    const hero = getHeroState({
      phase: 'nominating',
      userActions,
      groupProgress,
      lineupConfig,
    });

    expect(hero.tone).toBe('waiting');
    expect(hero.exitCondition).toBeDefined();
    expect(hero.cue).toContain("We'll DM you");
  });

  it('keeps tone=action in voting when votesSubmittedAt is null even if nominations were submitted', () => {
    const lineup = createMockLineupDetail({
      viewerSubmissions: {
        nominationsSubmittedAt: '2026-05-17T00:00:00Z',
        votesSubmittedAt: null,
      },
    });

    const userActions = fullUserActions(
      mapViewerSubmissionsToUserActions(lineup),
    );
    const hero = getHeroState({
      phase: 'voting',
      userActions,
      groupProgress,
      lineupConfig,
    });

    expect(hero.tone).toBe('action');
  });

  it('flips to tone=waiting in voting once votesSubmittedAt is non-null', () => {
    const lineup = createMockLineupDetail({
      viewerSubmissions: {
        nominationsSubmittedAt: '2026-05-17T00:00:00Z',
        votesSubmittedAt: '2026-05-17T01:00:00Z',
      },
    });

    const userActions = fullUserActions(
      mapViewerSubmissionsToUserActions(lineup),
    );
    const hero = getHeroState({
      phase: 'voting',
      userActions,
      groupProgress,
      lineupConfig,
    });

    expect(hero.tone).toBe('waiting');
  });
});
