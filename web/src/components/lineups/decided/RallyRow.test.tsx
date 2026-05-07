/**
 * Tests for RallyRow confirmation pill (ROK-1209 ROK-1125 join-match AC).
 *
 * When `isMember`: render small pill instead of disabled button.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { RallyRow } from './RallyRow';

vi.mock('../../../hooks/use-auth', () => ({
  useAuth: vi.fn(() => ({ user: { id: 99, role: 'member' } })),
  isOperatorOrAdmin: vi.fn(() => false),
}));

vi.mock('../../../hooks/use-lineup-matches', () => ({
  useBandwagonJoin: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useAdvanceMatch: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

function makeMatch(memberIds: number[]): MatchDetailResponseDto {
  return {
    id: 1,
    lineupId: 1,
    gameId: 42,
    gameName: 'Hollowforge',
    gameCoverUrl: null,
    status: 'scheduling',
    thresholdMet: false,
    voteCount: 1,
    votePercentage: 25,
    fitType: 'undersubscribed',
    linkedEventId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    members: memberIds.map((uid, i) => ({
      id: i + 1,
      matchId: 1,
      userId: uid,
      source: 'voted',
      createdAt: '2026-01-01T00:00:00Z',
      displayName: `U${uid}`,
      avatar: null,
      discordId: null,
      customAvatarUrl: null,
    })),
  } as MatchDetailResponseDto;
}

describe('RallyRow — confirmation pill (ROK-1209)', () => {
  it("renders 'You're in' pill when current user is a member", () => {
    renderWithProviders(
      <RallyRow
        match={makeMatch([99])}
        lineupId={1}
        matchThreshold={5}
        isRallied={false}
      />,
    );
    const pill = screen.getByTestId('confirmation-pill');
    expect(pill).toHaveTextContent(/you're in/i);
  });

  it('does NOT render the pill when current user is not a member', () => {
    renderWithProviders(
      <RallyRow
        match={makeMatch([50])}
        lineupId={1}
        matchThreshold={5}
        isRallied={false}
      />,
    );
    expect(screen.queryByTestId('confirmation-pill')).not.toBeInTheDocument();
  });
});
