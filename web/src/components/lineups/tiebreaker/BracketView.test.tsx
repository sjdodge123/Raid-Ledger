/**
 * Tests for BracketView confirmation pill (ROK-1209 AC-10).
 *
 * Above the matchup list, render `<ConfirmationPill variant="count">Voted in
 * {votedCount} of {totalMatchups} matchups</ConfirmationPill>`.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { TiebreakerDetailDto, BracketMatchupDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { BracketView } from './BracketView';

vi.mock('../../../hooks/use-tiebreaker', () => ({
  useForceResolve: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCastBracketVote: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

function buildMatchup(
  overrides: Partial<BracketMatchupDto> = {},
): BracketMatchupDto {
  return {
    id: 1,
    round: 1,
    position: 1,
    gameA: { gameId: 10, gameName: 'A', gameCoverUrl: null, originalVoteCount: 5 },
    gameB: { gameId: 11, gameName: 'B', gameCoverUrl: null, originalVoteCount: 5 },
    isBye: false,
    winnerGameId: null,
    voteCountA: 0,
    voteCountB: 0,
    myVote: null,
    isActive: true,
    isCompleted: false,
    ...overrides,
  };
}

function buildTiebreaker(
  matchups: BracketMatchupDto[],
): TiebreakerDetailDto {
  return {
    id: 1,
    lineupId: 1,
    mode: 'bracket',
    status: 'active',
    tiedGameIds: [10, 11, 12, 13],
    originalVoteCount: 5,
    winnerGameId: null,
    roundDeadline: null,
    resolvedAt: null,
    currentRound: 1,
    totalRounds: 1,
    matchups,
    vetoStatus: null,
  };
}

describe('BracketView — progress pill (AC-10)', () => {
  it("shows 'Voted in 1 of 2 matchups' when user has voted in one", () => {
    const t = buildTiebreaker([
      buildMatchup({ id: 1, position: 1, myVote: 10 }),
      buildMatchup({ id: 2, position: 2, myVote: null }),
    ]);
    renderWithProviders(<BracketView tiebreaker={t} lineupId={1} />);
    const pill = screen.getByTestId('confirmation-pill');
    expect(pill).toHaveTextContent(/1 of 2/);
  });

  it("shows 'Voted in 2 of 2 matchups' when user has voted in all", () => {
    const t = buildTiebreaker([
      buildMatchup({ id: 1, position: 1, myVote: 10 }),
      buildMatchup({ id: 2, position: 2, myVote: 12 }),
    ]);
    renderWithProviders(<BracketView tiebreaker={t} lineupId={1} />);
    const pill = screen.getByTestId('confirmation-pill');
    expect(pill).toHaveTextContent(/2 of 2/);
  });

  it("shows 'Voted in 0 of 2 matchups' when user has not voted in any", () => {
    const t = buildTiebreaker([
      buildMatchup({ id: 1, position: 1, myVote: null }),
      buildMatchup({ id: 2, position: 2, myVote: null }),
    ]);
    renderWithProviders(<BracketView tiebreaker={t} lineupId={1} />);
    const pill = screen.getByTestId('confirmation-pill');
    expect(pill).toHaveTextContent(/0 of 2/);
  });
});
