/**
 * Tests for hasUserActedInPhase (ROK-1209).
 *
 * Pure function that decides whether the current user has done the
 * phase-specific action. Drives the persona resolution and pill visibility.
 */
import { describe, expect, it } from 'vitest';
import type {
  LineupDetailResponseDto,
  TiebreakerDetailDto,
} from '@raid-ledger/contract';
import { hasUserActedInPhase } from './lineup-acted';
import { createMockLineupDetail, createMockEntry } from '../test/lineup-factories';

interface UserShape {
  id: number;
}

function buildTiebreaker(
  overrides: Partial<TiebreakerDetailDto> = {},
): TiebreakerDetailDto {
  return {
    id: 1,
    lineupId: 1,
    mode: 'bracket',
    status: 'active',
    tiedGameIds: [10, 11],
    originalVoteCount: 5,
    winnerGameId: null,
    roundDeadline: null,
    resolvedAt: null,
    currentRound: 1,
    totalRounds: 1,
    matchups: [],
    vetoStatus: null,
    ...overrides,
  } as TiebreakerDetailDto;
}

describe('hasUserActedInPhase — building phase', () => {
  it('returns true when user has at least one nomination', () => {
    const lineup = createMockLineupDetail({
      status: 'building',
      entries: [
        createMockEntry({ id: 1, nominatedBy: { id: 99, displayName: 'Me' } }),
        createMockEntry({ id: 2, nominatedBy: { id: 50, displayName: 'Other' } }),
      ],
    });
    expect(hasUserActedInPhase(lineup, null, { id: 99 })).toBe(true);
  });

  it('returns false when user has no nominations', () => {
    const lineup = createMockLineupDetail({
      status: 'building',
      entries: [
        createMockEntry({ id: 1, nominatedBy: { id: 50, displayName: 'Other' } }),
      ],
    });
    expect(hasUserActedInPhase(lineup, null, { id: 99 })).toBe(false);
  });

  it('returns false when there are no entries at all', () => {
    const lineup = createMockLineupDetail({ status: 'building', entries: [] });
    expect(hasUserActedInPhase(lineup, null, { id: 99 })).toBe(false);
  });
});

describe('hasUserActedInPhase — voting phase', () => {
  it('returns true when myVotes has at least one entry', () => {
    const lineup = createMockLineupDetail({ status: 'voting', myVotes: [42] });
    expect(hasUserActedInPhase(lineup, null, { id: 99 })).toBe(true);
  });

  it('returns false when myVotes is empty', () => {
    const lineup = createMockLineupDetail({ status: 'voting', myVotes: [] });
    expect(hasUserActedInPhase(lineup, null, { id: 99 })).toBe(false);
  });

  it("treats voting as acted regardless of nominations (spec edge case #3)", () => {
    const lineup = createMockLineupDetail({
      status: 'voting',
      myVotes: [42],
      entries: [
        createMockEntry({ id: 1, nominatedBy: { id: 50, displayName: 'Other' } }),
      ],
    });
    expect(hasUserActedInPhase(lineup, null, { id: 99 })).toBe(true);
  });
});

describe('hasUserActedInPhase — tiebreaker (bracket)', () => {
  it('returns true when at least one matchup has myVote != null', () => {
    const lineup = createMockLineupDetail({ status: 'voting' });
    const tiebreaker = buildTiebreaker({
      mode: 'bracket',
      matchups: [
        {
          id: 1, round: 1, position: 1,
          gameA: { gameId: 10, gameName: 'A', gameCoverUrl: null, originalVoteCount: 5 },
          gameB: { gameId: 11, gameName: 'B', gameCoverUrl: null, originalVoteCount: 5 },
          isBye: false, winnerGameId: null,
          voteCountA: 1, voteCountB: 0,
          myVote: 10,
          isActive: true, isCompleted: false,
        },
      ],
    });
    expect(hasUserActedInPhase(lineup, tiebreaker, { id: 99 })).toBe(true);
  });

  it('returns false when every matchup has myVote == null', () => {
    const lineup = createMockLineupDetail({ status: 'voting' });
    const tiebreaker = buildTiebreaker({
      mode: 'bracket',
      matchups: [
        {
          id: 1, round: 1, position: 1,
          gameA: { gameId: 10, gameName: 'A', gameCoverUrl: null, originalVoteCount: 5 },
          gameB: { gameId: 11, gameName: 'B', gameCoverUrl: null, originalVoteCount: 5 },
          isBye: false, winnerGameId: null,
          voteCountA: 0, voteCountB: 0,
          myVote: null,
          isActive: true, isCompleted: false,
        },
      ],
    });
    // myVotes is empty AND no bracket vote → not acted
    expect(hasUserActedInPhase(lineup, tiebreaker, { id: 99 })).toBe(false);
  });
});

describe('hasUserActedInPhase — tiebreaker (veto)', () => {
  it('returns true when myVetoGameId is set', () => {
    const lineup = createMockLineupDetail({ status: 'voting' });
    const tiebreaker = buildTiebreaker({
      mode: 'veto',
      matchups: null,
      vetoStatus: {
        games: [],
        totalVetoes: 1,
        vetoCap: 1,
        revealed: false,
        myVetoGameId: 10,
        survivorGameId: null,
      },
    });
    expect(hasUserActedInPhase(lineup, tiebreaker, { id: 99 })).toBe(true);
  });

  it('returns false when myVetoGameId is null', () => {
    const lineup = createMockLineupDetail({ status: 'voting' });
    const tiebreaker = buildTiebreaker({
      mode: 'veto',
      matchups: null,
      vetoStatus: {
        games: [],
        totalVetoes: 0,
        vetoCap: 1,
        revealed: false,
        myVetoGameId: null,
        survivorGameId: null,
      },
    });
    expect(hasUserActedInPhase(lineup, tiebreaker, { id: 99 })).toBe(false);
  });
});

describe('hasUserActedInPhase — decided phase', () => {
  it('returns true when user has voted on the lineup (myVotes > 0)', () => {
    const lineup = createMockLineupDetail({ status: 'decided', myVotes: [42] });
    expect(hasUserActedInPhase(lineup, null, { id: 99 })).toBe(true);
  });

  it('returns false when user did not vote during voting phase', () => {
    const lineup = createMockLineupDetail({ status: 'decided', myVotes: [] });
    expect(hasUserActedInPhase(lineup, null, { id: 99 })).toBe(false);
  });
});

describe('hasUserActedInPhase — archived phase', () => {
  it('returns false in archived state regardless of votes', () => {
    const lineup = createMockLineupDetail({ status: 'archived', myVotes: [42] });
    expect(hasUserActedInPhase(lineup, null, { id: 99 })).toBe(false);
  });
});

describe('hasUserActedInPhase — anonymous user', () => {
  it('returns false for null user', () => {
    const lineup = createMockLineupDetail({ status: 'building', myVotes: [42] });
    expect(hasUserActedInPhase(lineup, null, null)).toBe(false);
  });

  it('returns false for undefined user', () => {
    const lineup = createMockLineupDetail({ status: 'voting', myVotes: [42] });
    expect(hasUserActedInPhase(lineup, null, undefined as unknown as UserShape)).toBe(false);
  });
});
