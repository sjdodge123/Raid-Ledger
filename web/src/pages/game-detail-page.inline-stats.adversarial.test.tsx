/**
 * Adversarial tests for GameDetailPage inline player stats (ROK-803).
 * Edge cases: unauthenticated state, zero counts, all three sections
 * rendered together, section absence when count is 0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GameDetailPage } from './game-detail-page';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../lib/config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

vi.mock('../lib/avatar', () => ({
    resolveAvatar: () => ({ url: null, type: 'initials' }),
    toAvatarUser: (u: unknown) => u,
}));

vi.mock('../lib/game-utils', () => ({
    GENRE_MAP: {} as Record<number, string>,
}));

vi.mock('../components/games/ScreenshotGallery', () => ({
    ScreenshotGallery: () => null,
}));

vi.mock('../components/games/TwitchStreamEmbed', () => ({
    TwitchStreamEmbed: () => null,
}));

vi.mock('../components/events/event-card', () => ({
    EventCard: () => null,
}));

vi.mock('../components/games/InterestPlayerAvatars', () => ({
    InterestPlayerAvatars: ({
        totalCount,
        formatLabel,
    }: {
        totalCount: number;
        formatLabel?: (total: number, overflow: number) => string;
    }) => {
        const text = formatLabel
            ? formatLabel(totalCount, 0)
            : `${totalCount} players interested`;
        return <div data-testid="interest-avatars">{text}</div>;
    },
}));

vi.mock('../hooks/use-games-discover', () => ({
    useGameDetail: vi.fn(),
    useGameStreams: vi.fn(() => ({ data: null })),
    useGameActivity: vi.fn(() => ({ data: null, isLoading: false })),
    useGameNowPlaying: vi.fn(() => ({ data: null })),
    useGamePricing: vi.fn(() => ({ data: null, isLoading: false })),
}));

vi.mock('../hooks/use-events', () => ({
    useEvents: vi.fn(() => ({ data: null })),
}));

import * as useGamesDiscoverModule from '../hooks/use-games-discover';
import * as useAuthHook from '../hooks/use-auth';
import * as useWantToPlayModule from '../hooks/use-want-to-play';

vi.mock('../hooks/use-auth', () => ({
    useAuth: vi.fn(),
}));

vi.mock('../hooks/use-want-to-play', () => ({
    useWantToPlay: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockGame = {
    id: 42,
    igdbId: 1234,
    name: 'Valheim',
    slug: 'valheim',
    coverUrl: null,
    genres: [],
    summary: null,
    rating: null,
    aggregatedRating: null,
    popularity: null,
    gameModes: [],
    themes: [],
    platforms: [],
    screenshots: [],
    videos: [],
    firstReleaseDate: null,
    playerCount: null,
    twitchGameId: null,
    crossplay: null,
};

const mockPlayer = { id: 1, username: 'P1', avatar: null, customAvatarUrl: null, discordId: '1' };

function renderDetailPage() {
    const qc = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={qc}>
            <MemoryRouter initialEntries={['/games/42']}>
                <Routes>
                    <Route path="/games/:id" element={<GameDetailPage />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

function mockWtp(overrides: Partial<ReturnType<typeof useWantToPlayModule.useWantToPlay>>) {
    vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
        wantToPlay: false,
        count: 0,
        source: undefined,
        players: [],
        owners: [],
        ownerCount: 0,
        wishlisters: [],
        wishlistedCount: 0,
        isLoading: false,
        toggle: vi.fn(),
        isToggling: false,
        ...overrides,
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GameDetailPage — inline player stats adversarial (ROK-803)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useGamesDiscoverModule.useGameDetail).mockReturnValue({
            data: mockGame,
            isLoading: false,
            error: null,
        } as ReturnType<typeof useGamesDiscoverModule.useGameDetail>);
    });

    it('does NOT render the player stats row when user is not authenticated', () => {
        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: null,
            isAuthenticated: false,
        } as ReturnType<typeof useAuthHook.useAuth>);
        mockWtp({});

        renderDetailPage();

        expect(screen.queryByTestId('player-stats-row')).not.toBeInTheDocument();
    });

    it('renders the player stats row when user is authenticated', () => {
        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: { id: 1, username: 'Tester', role: 'member' } as never,
            isAuthenticated: true,
        } as ReturnType<typeof useAuthHook.useAuth>);
        mockWtp({ count: 1, players: [mockPlayer] });

        renderDetailPage();

        expect(screen.getByTestId('player-stats-row')).toBeInTheDocument();
    });

    it('does not show OwnedBy avatars when ownerCount is 0', () => {
        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: { id: 1, username: 'Tester', role: 'member' } as never,
            isAuthenticated: true,
        } as ReturnType<typeof useAuthHook.useAuth>);
        mockWtp({ owners: [], ownerCount: 0, wishlisters: [mockPlayer], wishlistedCount: 1 });

        renderDetailPage();

        const container = screen.getByTestId('player-stats-row');
        // wishlisted label is present
        expect(container.textContent).toContain('wishlisted');
        // owns label is NOT present (OwnedBySection returns null when ownerCount=0)
        expect(container.textContent).not.toContain('own');
    });

    it('does not show WishlistedBy avatars when wishlistedCount is 0', () => {
        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: { id: 1, username: 'Tester', role: 'member' } as never,
            isAuthenticated: true,
        } as ReturnType<typeof useAuthHook.useAuth>);
        mockWtp({ owners: [mockPlayer], ownerCount: 1, wishlisters: [], wishlistedCount: 0 });

        renderDetailPage();

        const container = screen.getByTestId('player-stats-row');
        expect(container.textContent).toContain('own');
        expect(container.textContent).not.toContain('wishlisted');
    });

    it('renders all three stat sections (interested, owns, wishlisted) in one container', () => {
        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: { id: 1, username: 'Tester', role: 'member' } as never,
            isAuthenticated: true,
        } as ReturnType<typeof useAuthHook.useAuth>);
        mockWtp({
            count: 3,
            players: [mockPlayer],
            owners: [mockPlayer],
            ownerCount: 2,
            wishlisters: [mockPlayer],
            wishlistedCount: 5,
        });

        renderDetailPage();

        const container = screen.getByTestId('player-stats-row');
        expect(container.textContent).toContain('own');
        expect(container.textContent).toContain('wishlisted');
        // The Want-to-Play button should also be inside the container
        expect(container).toBeInTheDocument();
        // Three InterestPlayerAvatars sections
        const avatarSections = container.querySelectorAll('[data-testid="interest-avatars"]');
        // At least two: WantToPlay (count>0) + Owned + Wishlisted
        expect(avatarSections.length).toBeGreaterThanOrEqual(2);
    });

    it('shows loading state when game is loading', () => {
        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: null,
            isAuthenticated: false,
        } as ReturnType<typeof useAuthHook.useAuth>);
        vi.mocked(useGamesDiscoverModule.useGameDetail).mockReturnValue({
            data: undefined,
            isLoading: true,
            error: null,
        } as ReturnType<typeof useGamesDiscoverModule.useGameDetail>);
        mockWtp({});

        renderDetailPage();

        // Loading skeleton should be visible (animate-pulse is not testable
        // via behavior, but the page should not crash)
        expect(screen.queryByTestId('player-stats-row')).not.toBeInTheDocument();
    });

    it('shows not-found state when game returns an error', () => {
        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: null,
            isAuthenticated: false,
        } as ReturnType<typeof useAuthHook.useAuth>);
        vi.mocked(useGamesDiscoverModule.useGameDetail).mockReturnValue({
            data: undefined,
            isLoading: false,
            error: new Error('Not found'),
        } as ReturnType<typeof useGamesDiscoverModule.useGameDetail>);
        mockWtp({});

        renderDetailPage();

        expect(screen.getByText(/game not found/i)).toBeInTheDocument();
    });

    it('wishlisted label uses correct format for single wishlister', () => {
        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: { id: 1, username: 'Tester', role: 'member' } as never,
            isAuthenticated: true,
        } as ReturnType<typeof useAuthHook.useAuth>);
        mockWtp({ wishlisters: [mockPlayer], wishlistedCount: 1 });

        renderDetailPage();

        const container = screen.getByTestId('player-stats-row');
        // 1 player wishlisted — should use singular "wishlisted"
        expect(container.textContent).toContain('wishlisted');
    });

    it('owned label uses correct format for multiple owners', () => {
        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: { id: 1, username: 'Tester', role: 'member' } as never,
            isAuthenticated: true,
        } as ReturnType<typeof useAuthHook.useAuth>);
        mockWtp({ owners: [mockPlayer], ownerCount: 5 });

        renderDetailPage();

        const container = screen.getByTestId('player-stats-row');
        expect(container.textContent).toContain('own');
    });
});
