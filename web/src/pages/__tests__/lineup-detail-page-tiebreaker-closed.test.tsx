/**
 * lineup-detail-page-tiebreaker-closed.test.tsx (ROK-1117)
 *
 * Verifies the late-join "Vote closed at HH:MM" empty state renders for
 * users who navigate to a lineup whose tiebreaker has resolved and the
 * lineup has already advanced to 'decided'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Hook mocks ────────────────────────────────────────────────────────────

let mockLineup: unknown = null;
let mockTiebreaker: unknown = null;

vi.mock('../../hooks/use-lineups', () => ({
    useLineupDetail: () => ({ data: mockLineup, isLoading: false, error: null }),
}));

vi.mock('../../hooks/use-lineup-realtime', () => ({
    useLineupRealtime: () => {},
}));

vi.mock('../../hooks/use-tiebreaker', () => ({
    useTiebreakerDetail: () => ({ data: mockTiebreaker }),
    useForceResolve: () => ({ mutate: vi.fn(), isPending: false }),
    useCastVeto: () => ({ mutate: vi.fn() }),
    useCastBracketVote: () => ({ mutate: vi.fn() }),
    useDismissTiebreaker: () => ({ mutate: vi.fn(), isPending: false }),
    useStartTiebreaker: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ user: { id: 1, username: 'Tester' }, isAuthenticated: true }),
    isOperatorOrAdmin: () => false,
}));

vi.mock('../../hooks/use-ai-suggestions', () => ({
    useAiSuggestions: () => ({ data: null }),
}));

vi.mock('../../hooks/use-ai-suggestions-available', () => ({
    useAiSuggestionsAvailable: () => false,
}));

vi.mock('../../hooks/use-steam-paste', () => ({
    useSteamPasteDetection: () => {},
}));

vi.mock('../../lib/lineup-eligibility', () => ({
    canParticipateInLineup: () => true,
}));

// ─── Component mocks (silence everything not under test) ──────────────────

vi.mock('../../components/lineups/LineupDetailHeader', () => ({
    LineupDetailHeader: () => <div data-testid="lineup-header" />,
}));
vi.mock('../../components/lineups/InviteeList', () => ({
    InviteeList: () => null,
}));
vi.mock('../../components/lineups/AddInviteesButton', () => ({
    AddInviteesButton: () => null,
}));
vi.mock('../../components/lineups/NominationGrid', () => ({
    NominationGrid: () => null,
}));
vi.mock('../../components/lineups/VotingLeaderboard', () => ({
    VotingLeaderboard: () => null,
}));
vi.mock('../../components/lineups/LineupEmptyState', () => ({
    LineupEmptyState: () => null,
}));
vi.mock('../../components/lineups/LineupDetailSkeleton', () => ({
    LineupDetailSkeleton: () => null,
}));
vi.mock('../../components/lineups/CommonGroundPanel', () => ({
    CommonGroundPanel: () => null,
}));
vi.mock('../../components/lineups/NominateModal', () => ({
    NominateModal: () => null,
}));
vi.mock('../../components/lineups/PastLineups', () => ({
    PastLineups: () => null,
}));
vi.mock('../../components/lineups/decided/DecidedView', () => ({
    DecidedView: () => <div data-testid="decided-view" />,
}));
vi.mock('../../components/common/ActivityTimeline', () => ({
    ActivityTimeline: () => null,
}));
vi.mock('../../components/lineups/SteamNudgeBanner', () => ({
    SteamNudgeBanner: () => null,
}));
vi.mock('../../components/lineups/tiebreaker/TiebreakerPromptModal', () => ({
    TiebreakerPromptModal: () => null,
}));

// Import after mocks
import { LineupDetailPage } from '../lineup-detail-page';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeLineup(overrides: Record<string, unknown> = {}) {
    return {
        id: 7,
        title: 'Test Lineup',
        status: 'decided',
        visibility: 'public',
        entries: [],
        invitees: [],
        myVotes: [],
        totalVoters: 0,
        totalMembers: 0,
        maxVotesPerPlayer: 3,
        createdBy: { id: 99 },
        ...overrides,
    };
}

function makeTiebreaker(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        lineupId: 7,
        mode: 'bracket',
        status: 'resolved',
        tiedGameIds: [10, 20],
        originalVoteCount: 5,
        winnerGameId: 10,
        roundDeadline: null,
        resolvedAt: '2026-04-27T15:30:00Z',
        currentRound: 1,
        totalRounds: 1,
        matchups: [],
        vetoStatus: null,
        ...overrides,
    };
}

function renderPage() {
    const qc = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { retry: false },
        },
    });
    return render(
        <QueryClientProvider client={qc}>
            <MemoryRouter initialEntries={['/community-lineup/7']}>
                <Routes>
                    <Route
                        path="/community-lineup/:id"
                        element={<LineupDetailPage />}
                    />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('LineupDetailPage tiebreaker closed notice (ROK-1117)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders TiebreakerClosedNotice for decided lineup with resolved tiebreaker', () => {
        mockLineup = makeLineup({ status: 'decided' });
        mockTiebreaker = makeTiebreaker({ status: 'resolved' });

        renderPage();

        expect(screen.getByTestId('tiebreaker-vote-closed')).toBeInTheDocument();
        expect(screen.queryByTestId('decided-view')).not.toBeInTheDocument();
    });

    it('falls back to DecidedView when no tiebreaker exists', () => {
        mockLineup = makeLineup({ status: 'decided' });
        mockTiebreaker = null;

        renderPage();

        expect(screen.queryByTestId('tiebreaker-vote-closed')).not.toBeInTheDocument();
        expect(screen.getByTestId('decided-view')).toBeInTheDocument();
    });

    it('does not render closed notice for decided lineup with non-resolved tiebreaker', () => {
        // After dismiss, server returns null (findPendingOrActiveTiebreaker
        // filters dismissed). Just be defensive: even if a stale dismissed row
        // surfaced, the gate must not render the notice for it.
        mockLineup = makeLineup({ status: 'decided' });
        mockTiebreaker = makeTiebreaker({ status: 'dismissed' });

        renderPage();

        expect(screen.queryByTestId('tiebreaker-vote-closed')).not.toBeInTheDocument();
        expect(screen.getByTestId('decided-view')).toBeInTheDocument();
    });
});
