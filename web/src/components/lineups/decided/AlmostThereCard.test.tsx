/**
 * Tests for AlmostThereCard confirmation pill (ROK-1209 ROK-1125 join-match AC).
 *
 * When `isMember`: replace the disabled "Joined" button with
 * `<ConfirmationPill variant="text" size="sm">You're in</ConfirmationPill>`.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { AlmostThereCard } from './AlmostThereCard';

vi.mock('../../../hooks/use-auth', () => ({
  useAuth: vi.fn(() => ({ user: { id: 99, role: 'member' } })),
  isOperatorOrAdmin: vi.fn(() => false),
}));

vi.mock('../../../hooks/use-lineup-matches', () => ({
  useBandwagonJoin: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

function makeMatch(
  members: { userId: number }[],
): MatchDetailResponseDto {
  return {
    id: 1,
    lineupId: 1,
    gameId: 42,
    gameName: 'Hollowforge',
    gameCoverUrl: null,
    status: 'scheduling',
    thresholdMet: false,
    voteCount: 5,
    votePercentage: 50,
    fitType: 'normal',
    linkedEventId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    members: members.map((m, i) => ({
      id: i + 1,
      matchId: 1,
      userId: m.userId,
      source: 'voted',
      createdAt: '2026-01-01T00:00:00Z',
      displayName: `User ${m.userId}`,
      avatar: null,
      discordId: null,
      customAvatarUrl: null,
    })),
  } as MatchDetailResponseDto;
}

describe('AlmostThereCard — confirmation pill (ROK-1209)', () => {
  it("renders 'You're in' pill when current user is a member", () => {
    const match = makeMatch([{ userId: 99 }]);
    renderWithProviders(
      <AlmostThereCard match={match} lineupId={1} matchThreshold={3} />,
    );
    const pill = screen.getByTestId('confirmation-pill');
    expect(pill).toHaveTextContent(/you're in/i);
  });

  it('does NOT render the pill when current user is not a member', () => {
    const match = makeMatch([{ userId: 50 }]);
    renderWithProviders(
      <AlmostThereCard match={match} lineupId={1} matchThreshold={3} />,
    );
    expect(screen.queryByTestId('confirmation-pill')).not.toBeInTheDocument();
  });

  it("does NOT render the legacy disabled 'Joined' button when user is a member", () => {
    const match = makeMatch([{ userId: 99 }]);
    renderWithProviders(
      <AlmostThereCard match={match} lineupId={1} matchThreshold={3} />,
    );
    expect(
      screen.queryByRole('button', { name: /^Joined$/i }),
    ).not.toBeInTheDocument();
  });
});
