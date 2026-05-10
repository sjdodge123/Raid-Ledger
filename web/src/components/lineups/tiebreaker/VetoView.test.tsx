/**
 * Tests for VetoView confirmation pill (ROK-1209 AC-11).
 *
 * When veto.myVetoGameId != null, render
 * `<ConfirmationPill variant="text" tone="danger">You eliminated a game</ConfirmationPill>`
 * above the grid.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { TiebreakerDetailDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { VetoView } from './VetoView';

vi.mock('../../../hooks/use-tiebreaker', () => ({
  useForceResolve: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCastVeto: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

function buildTiebreaker(
  myVetoGameId: number | null,
): TiebreakerDetailDto {
  return {
    id: 1,
    lineupId: 1,
    mode: 'veto',
    status: 'active',
    tiedGameIds: [10, 11, 12],
    originalVoteCount: 5,
    winnerGameId: null,
    roundDeadline: null,
    resolvedAt: null,
    currentRound: null,
    totalRounds: null,
    matchups: null,
    vetoStatus: {
      games: [
        {
          gameId: 10,
          gameName: 'Hollowforge',
          gameCoverUrl: null,
          vetoCount: myVetoGameId === 10 ? 1 : 0,
          isEliminated: false,
          isWinner: false,
        },
        {
          gameId: 11,
          gameName: 'Deep Rock',
          gameCoverUrl: null,
          vetoCount: 0,
          isEliminated: false,
          isWinner: false,
        },
      ],
      totalVetoes: myVetoGameId !== null ? 1 : 0,
      vetoCap: 2,
      revealed: false,
      myVetoGameId,
      survivorGameId: null,
    },
  };
}

describe('VetoView — confirmation pill (AC-11)', () => {
  it("renders 'You eliminated a game' pill when myVetoGameId != null", () => {
    renderWithProviders(<VetoView tiebreaker={buildTiebreaker(10)} lineupId={1} />);
    const pill = screen.getByTestId('confirmation-pill');
    expect(pill).toHaveTextContent(/you eliminated a game/i);
    expect(pill).toHaveAttribute('data-tone', 'danger');
  });

  it('does NOT render the pill when myVetoGameId is null', () => {
    renderWithProviders(<VetoView tiebreaker={buildTiebreaker(null)} lineupId={1} />);
    expect(screen.queryByTestId('confirmation-pill')).not.toBeInTheDocument();
  });
});
