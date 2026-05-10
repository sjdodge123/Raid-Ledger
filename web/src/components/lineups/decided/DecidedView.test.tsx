/**
 * Tests for DecidedView confirmation pills (ROK-1209 AC-12).
 *
 * For an `invitee-acted` persona, the decided view renders an aggregate
 * row of pills above the matches: "You voted for N games" + "You're in M matches".
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import {
  createMockLineupDetail,
  createMockEntry,
} from '../../../test/lineup-factories';
import { DecidedView } from './DecidedView';

// Mock auth — default to a "voter" user (id=99, member)
vi.mock('../../../hooks/use-auth', () => ({
  useAuth: vi.fn(() => ({ user: { id: 99, role: 'member' } })),
  isOperatorOrAdmin: vi.fn(() => false),
  isAdmin: vi.fn(() => false),
}));

// Mock the matches query so the view doesn't try to fetch.
vi.mock('../../../hooks/use-lineup-matches', () => ({
  useLineupMatches: vi.fn(() => ({
    data: {
      scheduling: [
        {
          id: 1,
          lineupId: 1,
          gameId: 42,
          gameName: 'Hollowforge',
          gameCoverUrl: null,
          status: 'scheduling',
          thresholdMet: true,
          voteCount: 5,
          votePercentage: 50,
          fitType: 'normal',
          linkedEventId: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          members: [
            {
              id: 1,
              matchId: 1,
              userId: 99,
              source: 'voted',
              createdAt: '2026-01-01T00:00:00Z',
              displayName: 'Me',
              avatar: null,
              discordId: null,
              customAvatarUrl: null,
            },
          ],
        },
      ],
      almostThere: [],
      rallyYourCrew: [],
      carriedForward: [],
    },
    isLoading: false,
  })),
  useBandwagonJoin: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useAdvanceMatch: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

describe('DecidedView — aggregate confirmation pills (AC-12)', () => {
  it("renders 'You voted for N games' pill for invitee-acted persona", () => {
    const lineup = createMockLineupDetail({
      status: 'decided',
      decidedGameId: 42,
      decidedGameName: 'Hollowforge',
      myVotes: [42, 43, 44],
      entries: [
        createMockEntry({ id: 1, gameId: 42, gameName: 'Hollowforge' }),
        createMockEntry({ id: 2, gameId: 43, gameName: 'Deep Rock' }),
        createMockEntry({ id: 3, gameId: 44, gameName: 'Phasmo' }),
      ],
    });
    renderWithProviders(<DecidedView lineup={lineup} />);
    const pills = screen.getAllByTestId('confirmation-pill');
    const text = pills.map((p) => p.textContent).join(' | ');
    expect(text).toMatch(/voted for 3 games/i);
  });

  it("renders 'You're in M matches' pill counting matches user is a member of", () => {
    const lineup = createMockLineupDetail({
      status: 'decided',
      decidedGameId: 42,
      decidedGameName: 'Hollowforge',
      myVotes: [42],
      entries: [createMockEntry({ id: 1, gameId: 42, gameName: 'Hollowforge' })],
    });
    renderWithProviders(<DecidedView lineup={lineup} />);
    const pills = screen.getAllByTestId('confirmation-pill');
    const text = pills.map((p) => p.textContent).join(' | ');
    expect(text).toMatch(/(in 1 match|1 matches)/i);
  });
});

describe('DecidedView — pills hidden for non-acted personas', () => {
  it('does NOT render the aggregate pills when user has not voted', () => {
    const lineup = createMockLineupDetail({
      status: 'decided',
      myVotes: [],
      entries: [],
    });
    renderWithProviders(<DecidedView lineup={lineup} />);
    expect(screen.queryAllByTestId('confirmation-pill')).toHaveLength(0);
  });
});
