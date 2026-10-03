/**
 * lineup-detail-page-tiebreaker-prompt.test.tsx
 *
 * The operator tiebreaker prompt opens only when the operator's advance
 * attempt is intercepted (the header's onTiebreakerIntercept). A tiebreaker
 * row reported as 'pending' must not pop the prompt by itself — the server
 * starts tiebreakers straight into 'active', so that arm was unreachable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Hook mocks ────────────────────────────────────────────────────────────

let mockLineup: unknown = null;
let mockTiebreaker: unknown = null;

vi.mock('../../hooks/use-lineups', () => ({
    useLineupDetail: () => ({ data: mockLineup, isLoading: false, error: null }),
    useTransitionLineupStatus: () => ({ mutate: vi.fn() }),
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
    useAuth: () => ({ user: { id: 1, username: 'Operator' }, isAuthenticated: true }),
    isOperatorOrAdmin: () => true,
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
    LineupDetailHeader: (props: { onTiebreakerIntercept?: () => void }) => (
        <button data-testid="intercept" onClick={props.onTiebreakerIntercept}>
            Advance
        </button>
    ),
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
vi.mock('../../components/lineups/cycle-4/VotingComposite', () => ({
    VotingComposite: () => null,
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
    DecidedView: () => null,
}));
vi.mock('../../components/common/ActivityTimeline', () => ({
    ActivityTimeline: () => null,
}));
vi.mock('../../components/lineups/SteamNudgeBanner', () => ({
    SteamNudgeBanner: () => null,
}));
vi.mock('../../components/lineups/tie/TieReadinessSection', () => ({
    TieReadinessSection: () => null,
}));
vi.mock('../../components/lineups/tiebreaker/TiebreakerPromptModal', () => ({
    TiebreakerPromptModal: () => <div data-testid="tiebreaker-prompt" />,
}));

// Import after mocks
import { LineupDetailPage } from '../lineup-detail-page';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeLineup(overrides: Record<string, unknown> = {}) {
    return {
        id: 7,
        title: 'Test Lineup',
        status: 'voting',
        visibility: 'public',
        entries: [],
        invitees: [],
        myVotes: [],
        totalVoters: 0,
        totalMembers: 0,
        maxVotesPerPlayer: 3,
        stillWaitingOnVoters: [],
        createdBy: { id: 99 },
        ...overrides,
    };
}

function makeTiebreaker(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        lineupId: 7,
        mode: 'bracket',
        status: 'pending',
        tiedGameIds: [10, 20],
        originalVoteCount: 5,
        winnerGameId: null,
        roundDeadline: null,
        resolvedAt: null,
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

describe('LineupDetailPage operator tiebreaker prompt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLineup = makeLineup({ status: 'voting' });
        mockTiebreaker = makeTiebreaker({ status: 'pending' });
    });

    it('does not open the prompt for an operator just because a tiebreaker is pending', () => {
        renderPage();

        expect(screen.getByTestId('intercept')).toBeInTheDocument();
        expect(screen.queryByTestId('tiebreaker-prompt')).not.toBeInTheDocument();
    });

    it('opens the prompt when the operator advance is intercepted', async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click(screen.getByTestId('intercept'));

        expect(screen.getByTestId('tiebreaker-prompt')).toBeInTheDocument();
    });
});
