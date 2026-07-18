/**
 * Tests for DecidedView composite layout (ROK-1299, Cycle 4 S3).
 *
 * The Decided page is rewritten to the composite "multi-match output"
 * framing: JourneyHero on top (tone=action, active=2), a personal
 * "Your matches" section with per-match CTAs, an "Other matches in
 * this lineup" section (no CTAs), an optional leftover-voters row,
 * and CarriedForward below.
 *
 * Podium / Share-button / page-level Submit / LineupStatsPanel are
 * REMOVED. These tests assert their absence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import {
  createMockLineupDetail,
  createMockEntry,
} from '../../../test/lineup-factories';
import { DecidedView } from './DecidedView';
import type {
  GroupedMatchesResponseDto,
  MatchDetailResponseDto,
  LineupMatchMemberDto,
} from '@raid-ledger/contract';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const useAuthMock = vi.fn(() => ({
  user: {
    id: 99,
    discordId: 'd-99',
    username: 'me',
    displayName: 'Me',
    avatar: null,
    customAvatarUrl: null,
    role: 'member' as const,
    steamId: null,
    onboardingCompletedAt: null,
  },
}));

vi.mock('../../../hooks/use-auth', () => ({
  useAuth: () => useAuthMock(),
  isOperatorOrAdmin: vi.fn(() => false),
  isAdmin: vi.fn(() => false),
}));

const useLineupMatchesMock = vi.fn();

vi.mock('../../../hooks/use-lineup-matches', () => ({
  useLineupMatches: () => useLineupMatchesMock(),
  useBandwagonJoin: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useAdvanceMatch: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeMember(
  overrides: Partial<LineupMatchMemberDto> & { displayName?: string },
): MatchDetailResponseDto['members'][number] {
  return {
    id: 1,
    matchId: 1,
    userId: 99,
    source: 'voted',
    createdAt: '2026-01-01T00:00:00Z',
    displayName: 'Member',
    avatar: null,
    discordId: null,
    customAvatarUrl: null,
    ...overrides,
  };
}

function makeMatch(
  overrides: Partial<MatchDetailResponseDto> = {},
): MatchDetailResponseDto {
  return {
    id: 1,
    lineupId: 1,
    gameId: 42,
    gameName: 'Valheim',
    gameCoverUrl: null,
    status: 'scheduling',
    thresholdMet: true,
    voteCount: 6,
    votePercentage: 60,
    fitType: 'normal',
    linkedEventId: null,
    playerCap: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    members: [makeMember({ id: 1, userId: 99, displayName: 'Me' })],
    ...overrides,
  };
}

function makeMatches(
  overrides: Partial<GroupedMatchesResponseDto> = {},
): GroupedMatchesResponseDto {
  return {
    scheduling: [],
    almostThere: [],
    rallyYourCrew: [],
    carriedForward: [],
    matchThreshold: 3,
    totalVoters: 20,
    ...overrides,
  };
}

beforeEach(() => {
  useAuthMock.mockReturnValue({
    user: {
      id: 99,
      discordId: 'd-99',
      username: 'me',
      displayName: 'Me',
      avatar: null,
      customAvatarUrl: null,
      role: 'member',
      steamId: null,
      onboardingCompletedAt: null,
    },
  });
  useLineupMatchesMock.mockReturnValue({ data: makeMatches(), isLoading: false });
});

// ---------------------------------------------------------------------------
// AC1 — JourneyHero present, action tone
// ---------------------------------------------------------------------------

describe('DecidedView — JourneyHero (AC1)', () => {
  it('renders a JourneyHero region at the top with the Decided step badge', () => {
    const lineup = createMockLineupDetail({
      status: 'decided',
      entries: [createMockEntry({ id: 1, gameId: 42, gameName: 'Valheim' })],
    });
    renderWithProviders(<DecidedView lineup={lineup} />);

    // AC1: hero is the first visible region with the "Step 3 of 4 · Decided"
    // badge (or its uppercase variant — tone="action" wrapper).
    const region = screen.getByRole('region', { name: /step 3 of 4 · decided/i });
    expect(region).toBeInTheDocument();

    // AC1: the hero's wrapper must use the action-tone border class.
    // (The component's BORDER_CLS maps action → 'border-emerald-500/30 bg-panel/70'.)
    expect(region.className).toMatch(/border-emerald-500\/30/);
  });

  it('hero is positioned above all match sections', () => {
    const lineup = createMockLineupDetail({
      status: 'decided',
      entries: [createMockEntry({ id: 1, gameId: 42, gameName: 'Valheim' })],
    });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({ scheduling: [makeMatch()] }),
      isLoading: false,
    });
    renderWithProviders(<DecidedView lineup={lineup} />);

    const hero = screen.getByRole('region', { name: /step 3 of 4 · decided/i });
    const root = screen.getByTestId('decided-composite-view');
    // Hero is the first child of the composite root.
    expect(root.firstElementChild).toBe(hero);
  });
});

// ---------------------------------------------------------------------------
// ROK-1411 — loading state (no empty-copy flash mid-fetch)
// ---------------------------------------------------------------------------

describe('DecidedView — loading state (ROK-1411)', () => {
  it('renders a hero-only loading state without the empty-state copy while the query is pending', () => {
    const lineup = createMockLineupDetail({ status: 'decided' });
    useLineupMatchesMock.mockReturnValue({ data: undefined, isLoading: true });

    renderWithProviders(<DecidedView lineup={lineup} />);

    // Loading skeleton renders inside the composite root.
    expect(screen.getByTestId('decided-composite-view')).toBeInTheDocument();
    expect(screen.getByTestId('decided-loading')).toBeInTheDocument();

    // The misleading empty-state copy must NOT flash before data resolves.
    expect(
      screen.queryByText(/no matches were generated from voting results/i),
    ).toBeNull();
    expect(
      screen.queryByText(/you're not in any matches yet/i),
    ).toBeNull();

    // No match sections render during load.
    expect(screen.queryByTestId('decided-your-matches-section')).toBeNull();
    expect(screen.queryByTestId('decided-other-matches-section')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC2 — Your matches section + per-card CTA
// ---------------------------------------------------------------------------

describe('DecidedView — "Your matches" section (AC2)', () => {
  it('renders a "Your matches" section labelled with the count when user is in N matches', () => {
    const lineup = createMockLineupDetail({ status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 1,
            gameId: 42,
            gameName: 'Valheim',
            members: [makeMember({ id: 1, userId: 99, displayName: 'Me' })],
          }),
        ],
        almostThere: [
          makeMatch({
            id: 2,
            gameId: 43,
            gameName: 'Helldivers 2',
            members: [makeMember({ id: 2, userId: 99, displayName: 'Me' })],
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    const section = screen.getByTestId('decided-your-matches-section');
    expect(section).toBeInTheDocument();
    expect(within(section).getByText(/your matches \(2\)/i)).toBeInTheDocument();
  });

  it('every card in "Your matches" has a "Pick a time →" link to the schedule route', () => {
    const lineup = createMockLineupDetail({ id: 11, status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 7,
            lineupId: 11,
            gameId: 42,
            gameName: 'Valheim',
            members: [makeMember({ id: 1, userId: 99, displayName: 'Me' })],
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    const section = screen.getByTestId('decided-your-matches-section');
    const cta = within(section).getByRole('link', { name: /pick a time/i });
    expect(cta).toHaveAttribute('href', '/community-lineup/11/schedule/7');
  });
});

// ---------------------------------------------------------------------------
// AC3 — Other matches section, no CTA
// ---------------------------------------------------------------------------

describe('DecidedView — "Other matches" section (AC3)', () => {
  it('renders matches the user is NOT in under "Other matches" without CTAs', () => {
    const lineup = createMockLineupDetail({ status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 1,
            gameId: 42,
            gameName: 'Valheim',
            members: [makeMember({ id: 1, userId: 99, displayName: 'Me' })],
          }),
        ],
        almostThere: [
          makeMatch({
            id: 2,
            gameId: 88,
            gameName: 'Phasmophobia',
            members: [
              makeMember({ id: 9, userId: 200, displayName: 'Other A' }),
              makeMember({ id: 10, userId: 201, displayName: 'Other B' }),
            ],
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    const section = screen.getByTestId('decided-other-matches-section');
    expect(within(section).getByText(/other matches in this lineup \(1\)/i)).toBeInTheDocument();
    expect(within(section).getByText(/phasmophobia/i)).toBeInTheDocument();
    // No CTAs in this section.
    expect(within(section).queryByRole('link', { name: /pick a time/i })).toBeNull();
  });

  it('hides the "Other matches" section when there are no non-personal matches', () => {
    const lineup = createMockLineupDetail({ status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 1,
            gameId: 42,
            gameName: 'Valheim',
            members: [makeMember({ id: 1, userId: 99, displayName: 'Me' })],
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    // Composite root must render (gates the negative testid assertion).
    expect(screen.getByTestId('decided-composite-view')).toBeInTheDocument();
    expect(screen.queryByTestId('decided-other-matches-section')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC4 — Leftover voters CTA visibility
// ---------------------------------------------------------------------------

describe('DecidedView — leftover voters row (AC4)', () => {
  it('renders the leftover row when matched voters < totalVoters', () => {
    const lineup = createMockLineupDetail({ status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        totalVoters: 20,
        scheduling: [
          makeMatch({
            id: 1,
            gameId: 42,
            members: [
              makeMember({ id: 1, userId: 99 }),
              makeMember({ id: 2, userId: 200 }),
            ],
          }),
        ],
        // 18 of 20 matched → 2 leftover voters.
        almostThere: [
          makeMatch({
            id: 2,
            gameId: 43,
            members: Array.from({ length: 16 }, (_, i) =>
              makeMember({ id: 10 + i, userId: 300 + i }),
            ),
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    const row = screen.getByTestId('decided-leftover-voters-row');
    expect(within(row).getByText(/2 voters didn'?t match/i)).toBeInTheDocument();
    // CTA (suggest more games) exists, even if no-op per operator note.
    expect(within(row).getByRole('button', { name: /suggest more games/i })).toBeInTheDocument();
  });

  it('hides the leftover row when every voter was matched', () => {
    const lineup = createMockLineupDetail({ status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        totalVoters: 3,
        scheduling: [
          makeMatch({
            id: 1,
            gameId: 42,
            members: [
              makeMember({ id: 1, userId: 99 }),
              makeMember({ id: 2, userId: 200 }),
              makeMember({ id: 3, userId: 201 }),
            ],
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    // Composite root must render (gates the negative testid assertion).
    expect(screen.getByTestId('decided-composite-view')).toBeInTheDocument();
    expect(screen.queryByTestId('decided-leftover-voters-row')).toBeNull();
  });

  it('excludes bandwagon members from the matched-voter count', () => {
    // 5 voters total; 2 voted into a match; 1 bandwagon-joined that match.
    // Leftover MUST be 3 (5 - 2 voted), NOT 2 (5 - 3 incl. bandwagon).
    const lineup = createMockLineupDetail({ status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        totalVoters: 5,
        scheduling: [
          makeMatch({
            id: 1,
            gameId: 42,
            members: [
              makeMember({ id: 1, userId: 99, source: 'voted' }),
              makeMember({ id: 2, userId: 200, source: 'voted' }),
              makeMember({ id: 3, userId: 201, source: 'bandwagon' }),
            ],
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    const row = screen.getByTestId('decided-leftover-voters-row');
    expect(within(row).getByText(/3 voters didn'?t match/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC5 — No podium / no page-level Submit / no Share button / no AlsoRan
// ---------------------------------------------------------------------------

describe('DecidedView — podium and page Submit are gone (AC5)', () => {
  it('does NOT render the podium ("THIS WEEK\'S PODIUM" header is absent)', () => {
    const lineup = createMockLineupDetail({
      status: 'decided',
      entries: [createMockEntry({ id: 1, gameId: 42, gameName: 'Valheim' })],
    });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({ scheduling: [makeMatch()] }),
      isLoading: false,
    });
    renderWithProviders(<DecidedView lineup={lineup} />);

    expect(screen.queryByText(/this week'?s podium/i)).toBeNull();
    expect(screen.queryByTestId('podium-card')).toBeNull();
    expect(screen.queryByTestId('crown-icon')).toBeNull();
    expect(screen.queryByText(/champion/i)).toBeNull();
  });

  it('does NOT render a page-level Submit/Share action button', () => {
    const lineup = createMockLineupDetail({
      status: 'decided',
      entries: [createMockEntry({ id: 1, gameId: 42, gameName: 'Valheim' })],
    });
    renderWithProviders(<DecidedView lineup={lineup} />);

    expect(screen.queryByRole('button', { name: /^submit/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^share$/i })).toBeNull();
  });

  it('does NOT render the AlsoRanList or LineupStatsPanel sections', () => {
    const lineup = createMockLineupDetail({
      status: 'decided',
      entries: [createMockEntry({ id: 1, gameId: 42, gameName: 'Valheim' })],
    });
    renderWithProviders(<DecidedView lineup={lineup} />);

    expect(screen.queryByTestId('also-ran-section')).toBeNull();
    expect(screen.queryByTestId('lineup-stats-panel')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC6 — Drawer opens on row click, NOT on CTA click
// ---------------------------------------------------------------------------

describe('DecidedView — drawer interactions (AC6)', () => {
  it('clicking the row (NOT the CTA) opens the GameResearchDrawer', () => {
    const lineup = createMockLineupDetail({ id: 1, status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 1,
            lineupId: 1,
            gameId: 42,
            gameName: 'Valheim',
            members: [makeMember({ id: 1, userId: 99 })],
          }),
        ],
      }),
      isLoading: false,
    });
    navigateMock.mockClear();
    renderWithProviders(<DecidedView lineup={lineup} />);

    // ROK-1297 round 5y: GameResearchDrawer no longer renders a side
    // drawer — it navigates to /games/:id. Assert the navigate call
    // instead of looking for a `game-research-drawer` DOM node.
    expect(navigateMock).not.toHaveBeenCalled();

    const section = screen.getByTestId('decided-your-matches-section');
    const row = within(section).getByTestId('game-ref-row');
    fireEvent.click(row);

    expect(navigateMock).toHaveBeenCalledWith('/games/42');
  });

  it('clicking the per-match "Pick a time" CTA does NOT open the drawer', () => {
    const lineup = createMockLineupDetail({ id: 1, status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 7,
            lineupId: 1,
            gameId: 42,
            gameName: 'Valheim',
            members: [makeMember({ id: 1, userId: 99 })],
          }),
        ],
      }),
      isLoading: false,
    });
    renderWithProviders(<DecidedView lineup={lineup} />);

    const section = screen.getByTestId('decided-your-matches-section');
    const cta = within(section).getByRole('link', { name: /pick a time/i });
    fireEvent.click(cta);

    expect(screen.queryByTestId('game-research-drawer')).toBeNull();
  });

  // ROK-1302: scheduling-phase opt-out hides the "Pick a time" CTA.
  it('hides the "Pick a time" CTA when includeSchedulingPhase is false', () => {
    const lineup = createMockLineupDetail({
      id: 1,
      status: 'decided',
      includeSchedulingPhase: false,
    });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 7,
            lineupId: 1,
            gameId: 42,
            gameName: 'Valheim',
            members: [makeMember({ id: 1, userId: 99 })],
          }),
        ],
      }),
      isLoading: false,
    });
    renderWithProviders(<DecidedView lineup={lineup} />);

    // The match still renders (personal section present) but no schedule CTA.
    expect(
      screen.getByTestId('decided-your-matches-section'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /pick a time/i }),
    ).toBeNull();
  });

  // ROK-1302: default (true) still shows the CTA — guards against over-gating.
  it('shows the "Pick a time" CTA when includeSchedulingPhase is true', () => {
    const lineup = createMockLineupDetail({
      id: 1,
      status: 'decided',
      includeSchedulingPhase: true,
    });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 7,
            lineupId: 1,
            gameId: 42,
            gameName: 'Valheim',
            members: [makeMember({ id: 1, userId: 99 })],
          }),
        ],
      }),
      isLoading: false,
    });
    renderWithProviders(<DecidedView lineup={lineup} />);

    expect(
      screen.getByRole('link', { name: /pick a time/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC7 — Single-match edge case
// ---------------------------------------------------------------------------

describe('DecidedView — single-match edge case (AC7)', () => {
  it('renders correctly with exactly one personal match and no other matches', () => {
    const lineup = createMockLineupDetail({ id: 1, status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        totalVoters: 4,
        scheduling: [
          makeMatch({
            id: 5,
            lineupId: 1,
            gameId: 42,
            gameName: 'Valheim',
            members: [
              makeMember({ id: 1, userId: 99 }),
              makeMember({ id: 2, userId: 200 }),
              makeMember({ id: 3, userId: 201 }),
              makeMember({ id: 4, userId: 202 }),
            ],
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    const yourSection = screen.getByTestId('decided-your-matches-section');
    expect(within(yourSection).getByText(/your matches \(1\)/i)).toBeInTheDocument();
    expect(within(yourSection).getAllByTestId('decided-match-card')).toHaveLength(1);
    // Other matches section absent.
    expect(screen.queryByTestId('decided-other-matches-section')).toBeNull();
    // Leftover row absent (4 of 4 matched).
    expect(screen.queryByTestId('decided-leftover-voters-row')).toBeNull();
  });

  it('renders an Other-matches-only layout when the user is in zero personal matches', () => {
    const lineup = createMockLineupDetail({ id: 1, status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 1,
            lineupId: 1,
            gameId: 99,
            gameName: 'ARK',
            members: [
              makeMember({ id: 9, userId: 200, displayName: 'Other A' }),
              makeMember({ id: 10, userId: 201, displayName: 'Other B' }),
            ],
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    expect(screen.queryByTestId('decided-your-matches-section')).toBeNull();
    const other = screen.getByTestId('decided-other-matches-section');
    expect(within(other).getByText(/other matches in this lineup \(1\)/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// MatchCard sub-line copy — locks accurate personal-context wording.
// NOTE: these cases use matches with `playerCap: null` (no known cap), which
// falls back to the personal-context copy. The "X of Y players" / "group is
// full" denominator (ROK-1411, sourced from games.player_count.max) is
// covered by MatchCard.test.tsx; matchThreshold on GroupedMatchesResponseDto
// remains a 0–100 grouping percentage and is NOT a player count.
// ---------------------------------------------------------------------------

describe('DecidedView — MatchCard sub-line copy', () => {
  it('personal card shows "You + N others" (no false denominator) when group has multiple voters', () => {
    const lineup = createMockLineupDetail({ id: 1, status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 1,
            lineupId: 1,
            members: [
              makeMember({ id: 1, userId: 99 }),
              makeMember({ id: 2, userId: 200 }),
              makeMember({ id: 3, userId: 201 }),
              makeMember({ id: 4, userId: 202 }),
              makeMember({ id: 5, userId: 203 }),
              makeMember({ id: 6, userId: 204 }),
            ],
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    const yourSection = screen.getByTestId('decided-your-matches-section');
    expect(within(yourSection).getByText(/^You \+ 5 others$/i)).toBeInTheDocument();
    // No false denominator, no "group is full" surface.
    expect(within(yourSection).queryByText(/of \d+/i)).toBeNull();
    expect(within(yourSection).queryByText(/group is full/i)).toBeNull();
  });

  it('personal card with 1 other uses singular "other"', () => {
    const lineup = createMockLineupDetail({ id: 1, status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 1,
            lineupId: 1,
            members: [
              makeMember({ id: 1, userId: 99 }),
              makeMember({ id: 2, userId: 200 }),
            ],
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    const yourSection = screen.getByTestId('decided-your-matches-section');
    expect(within(yourSection).getByText(/^You \+ 1 other$/i)).toBeInTheDocument();
  });

  it('personal solo (only the viewer in the match) reads "Just you so far"', () => {
    const lineup = createMockLineupDetail({ id: 1, status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 1,
            lineupId: 1,
            members: [makeMember({ id: 1, userId: 99 })],
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    const yourSection = screen.getByTestId('decided-your-matches-section');
    expect(within(yourSection).getByText(/^Just you so far$/i)).toBeInTheDocument();
    expect(within(yourSection).queryByText(/You \+ 0 others/i)).toBeNull();
  });

  it('non-personal card shows just "N players" (no "of Y", no "You")', () => {
    const lineup = createMockLineupDetail({ id: 1, status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 1,
            lineupId: 1,
            members: [
              makeMember({ id: 9, userId: 200, displayName: 'A' }),
              makeMember({ id: 10, userId: 201, displayName: 'B' }),
              makeMember({ id: 11, userId: 202, displayName: 'C' }),
              makeMember({ id: 12, userId: 203, displayName: 'D' }),
              makeMember({ id: 13, userId: 204, displayName: 'E' }),
            ],
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    const otherSection = screen.getByTestId('decided-other-matches-section');
    expect(within(otherSection).getByText(/^5 players$/i)).toBeInTheDocument();
    expect(within(otherSection).queryByText(/of \d+/i)).toBeNull();
    expect(within(otherSection).queryByText(/You \+/i)).toBeNull();
  });

  it('non-personal card with 1 player uses singular "player"', () => {
    const lineup = createMockLineupDetail({ id: 1, status: 'decided' });
    useLineupMatchesMock.mockReturnValue({
      data: makeMatches({
        scheduling: [
          makeMatch({
            id: 1,
            lineupId: 1,
            members: [makeMember({ id: 9, userId: 200, displayName: 'A' })],
          }),
        ],
      }),
      isLoading: false,
    });

    renderWithProviders(<DecidedView lineup={lineup} />);

    const otherSection = screen.getByTestId('decided-other-matches-section');
    expect(within(otherSection).getByText(/^1 player$/i)).toBeInTheDocument();
  });
});
