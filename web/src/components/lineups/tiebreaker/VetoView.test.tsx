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


// ---------------------------------------------------------------------------
// ROK-1314 — the veto card is the FOURTH surface on the shared badge system.
// Review flagged that `fromVetoGameCard` had only a source-grep guard and this
// file asserted nothing about badges, leaving the veto half of AC3 unproven.
// The veto card renders the COMPACT set by design (spec §3.4): the viewer's
// own two pills, the owner aggregate and the price — no player count, no early
// access, no co-op.
// ---------------------------------------------------------------------------

/** A veto payload carrying the ROK-1314 badge fields. */
function buildBadgeTiebreaker(
  overrides: Record<string, unknown> = {},
): TiebreakerDetailDto {
  const base = buildTiebreaker(null);
  const games = base.vetoStatus!.games.map((g, i) =>
    i === 0
      ? {
          ...g,
          ownerCount: 7,
          wishlistCount: 2,
          currentUserOwns: true,
          currentUserWishlisted: false,
          itadCurrentPrice: 19.99,
          itadCurrentCut: 40,
          // Discounted but ABOVE the 9.99 history low => On Sale. (A lowest
          // ABOVE the current price would resolve Best Price instead — which
          // is what my first draft of this fixture accidentally encoded.)
          itadLowestPrice: 9.99,
          ...overrides,
        }
      : g,
  );
  return {
    ...base,
    vetoStatus: { ...base.vetoStatus!, games },
  } as TiebreakerDetailDto;
}

describe('VetoView — shared badge row (ROK-1314 AC3)', () => {
  it('renders the viewer pill ALONGSIDE the owner aggregate', () => {
    renderWithProviders(
      <VetoView tiebreaker={buildBadgeTiebreaker()} lineupId={1} />,
    );
    expect(screen.getByText('You own')).toBeInTheDocument();
    expect(screen.getByText('7 own')).toBeInTheDocument();
  });

  it('renders the locked price vocabulary, not a bare percentage', () => {
    renderWithProviders(
      <VetoView tiebreaker={buildBadgeTiebreaker()} lineupId={1} />,
    );
    expect(screen.getByText(/On Sale/)).toBeInTheDocument();
    expect(screen.queryByText(/^-40%$/)).not.toBeInTheDocument();
  });

  it('resolves Best Price when the current price is at the history low', () => {
    renderWithProviders(
      <VetoView
        tiebreaker={buildBadgeTiebreaker({ itadLowestPrice: 19.99 })}
        lineupId={1}
      />,
    );
    expect(screen.getByText(/Best Price/)).toBeInTheDocument();
  });

  it('shows no personalization for a viewer who owns nothing', () => {
    renderWithProviders(
      <VetoView
        tiebreaker={buildBadgeTiebreaker({ currentUserOwns: false })}
        lineupId={1}
      />,
    );
    expect(screen.queryByText('You own')).not.toBeInTheDocument();
    expect(screen.getByText('7 own')).toBeInTheDocument();
  });

  it('excludes the full-variant badges — veto is compact by design', () => {
    const { container } = renderWithProviders(
      <VetoView tiebreaker={buildBadgeTiebreaker()} lineupId={1} />,
    );
    expect(screen.queryByText('2 wishlisted')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="coop-pill"]')).toBeNull();
  });
});
