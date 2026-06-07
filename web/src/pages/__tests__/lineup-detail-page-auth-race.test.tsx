/**
 * lineup-detail-page-auth-race.test.tsx (ROK-1349 Part B)
 *
 * Regression for: a private-lineup invitee saw a disabled "view only"
 * nominate state on every card because eligibility was computed against a
 * still-loading (null) auth user. The page must wait for auth to settle
 * (render the skeleton) before deciding eligibility, so the real invitee is
 * never transiently treated as a non-participant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Hook mocks ────────────────────────────────────────────────────────────

const mockLineup = {
    id: 7,
    title: 'Private Lineup',
    status: 'building',
    visibility: 'private',
    entries: [],
    // helkth is a real invitee with no Steam tag.
    invitees: [{ id: 5, displayName: 'helkth', steamLinked: false }],
    myVotes: [],
    totalVoters: 0,
    totalMembers: 13,
    maxVotesPerPlayer: 3,
    createdBy: { id: 99, displayName: 'Owner' },
    votingEligibleCount: 2,
    viewerSubmissions: { nominationsSubmittedAt: null, votesSubmittedAt: null },
    stillWaitingOnVoters: [],
    pendingAdvanceAt: null,
};

let mockAuthLoading = false;

vi.mock('../../hooks/use-lineups', () => ({
    useLineupDetail: () => ({ data: mockLineup, isLoading: false, error: null }),
    useTransitionLineupStatus: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../hooks/use-lineup-realtime', () => ({
    useLineupRealtime: () => {},
}));
vi.mock('../../hooks/use-tiebreaker', () => ({
    useTiebreakerDetail: () => ({ data: null }),
}));
vi.mock('../../hooks/use-auth', () => ({
    // The invitee (id 5). When auth is still loading, `user` is undefined —
    // the page must NOT compute eligibility against that.
    useAuth: () => ({
        user: mockAuthLoading ? undefined : { id: 5, username: 'helkth' },
        isLoading: mockAuthLoading,
        isAuthenticated: !mockAuthLoading,
    }),
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

// ─── Component mocks ──────────────────────────────────────────────────────

vi.mock('../../components/lineups/LineupDetailSkeleton', () => ({
    LineupDetailSkeleton: () => <div data-testid="lineup-skeleton" />,
}));
vi.mock('../../components/lineups/LineupDetailHeader', () => ({
    LineupDetailHeader: () => <div data-testid="lineup-header" />,
}));
vi.mock('../../components/lineups/InviteeList', () => ({ InviteeList: () => null }));
vi.mock('../../components/lineups/AddInviteesButton', () => ({
    AddInviteesButton: () => null,
}));
vi.mock('../../components/lineups/StillWaitingPanel', () => ({
    StillWaitingPanel: () => null,
}));
vi.mock('../../components/lineups/SteamNudgeBanner', () => ({
    SteamNudgeBanner: () => null,
}));
vi.mock('../../components/lineups/PastLineups', () => ({ PastLineups: () => null }));
vi.mock('../../components/lineups/NominateModal', () => ({
    NominateModal: () => null,
}));
vi.mock('../../components/common/ActivityTimeline', () => ({
    ActivityTimeline: () => null,
}));
vi.mock('../../components/lineups/LineupDetailBody', () => ({
    LineupDetailBody: () => null,
}));
// Capture the canParticipate prop the composite is rendered with.
let capturedCanParticipate: boolean | null = null;
vi.mock('../../components/lineups/cycle-4/NominatingComposite', () => ({
    NominatingComposite: (props: { canParticipate: boolean }) => {
        capturedCanParticipate = props.canParticipate;
        return <div data-testid="nominating-composite" />;
    },
}));

import { LineupDetailPage } from '../lineup-detail-page';

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

describe('LineupDetailPage auth-loading race (ROK-1349 Part B)', () => {
    beforeEach(() => {
        capturedCanParticipate = null;
    });

    it('renders the skeleton (not the building UI) while auth is still loading', () => {
        mockAuthLoading = true;
        renderPage();
        expect(screen.getByTestId('lineup-skeleton')).toBeInTheDocument();
        expect(screen.queryByTestId('nominating-composite')).not.toBeInTheDocument();
        // Eligibility was never computed against the null user.
        expect(capturedCanParticipate).toBeNull();
    });

    it('grants the invitee participation once auth has settled', () => {
        mockAuthLoading = false;
        renderPage();
        expect(screen.getByTestId('nominating-composite')).toBeInTheDocument();
        expect(capturedCanParticipate).toBe(true);
    });
});
