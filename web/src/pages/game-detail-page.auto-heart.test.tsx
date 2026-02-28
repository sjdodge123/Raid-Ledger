/**
 * Adversarial unit tests for GameDetailPage — ROK-444 auto-heart tooltip.
 *
 * Verifies:
 * - Heart button shows tooltip "Auto-hearted based on your playtime" when source === 'discord'
 * - Heart button has no title when source is undefined or 'manual'
 * - Button text reflects want-to-play state correctly
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

// Mock heavy child components
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
    InterestPlayerAvatars: () => null,
}));

// Mock game discovery hooks
vi.mock('../hooks/use-games-discover', () => ({
    useGameDetail: vi.fn(),
    useGameStreams: vi.fn(() => ({ data: null })),
    useGameActivity: vi.fn(() => ({ data: null, isLoading: false })),
    useGameNowPlaying: vi.fn(() => ({ data: null })),
}));

vi.mock('../hooks/use-events', () => ({
    useEvents: vi.fn(() => ({ data: null })),
}));

import * as useGamesDiscoverModule from '../hooks/use-games-discover';
import * as useAuthHook from '../hooks/use-auth';
import * as useWantToPlayModule from '../hooks/use-want-to-play';

// Mock auth and want-to-play
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

function renderDetailPage(gameId = '42') {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[`/games/${gameId}`]}>
                <Routes>
                    <Route path="/games/:id" element={<GameDetailPage />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GameDetailPage — discord auto-heart tooltip (ROK-444, AC #4)', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(useGamesDiscoverModule.useGameDetail).mockReturnValue({
            data: mockGame,
            isLoading: false,
            error: null,
        } as ReturnType<typeof useGamesDiscoverModule.useGameDetail>);

        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: { id: 1, username: 'Tester', role: 'member' } as Parameters<typeof useAuthHook.useAuth>[0] extends undefined ? ReturnType<typeof useAuthHook.useAuth>['user'] : never,
            isAuthenticated: true,
        } as ReturnType<typeof useAuthHook.useAuth>);
    });

    // ── AC #4: Tooltip on discord-sourced hearts ─────────────────────────────

    it('shows title tooltip when source is discord', () => {
        vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
            wantToPlay: true,
            count: 3,
            source: 'discord',
            players: [],
            isLoading: false,
            toggle: vi.fn(),
            isToggling: false,
        });

        renderDetailPage();

        const heartButton = screen.getByRole('button', { name: /remove from list/i });
        expect(heartButton).toHaveAttribute(
            'title',
            'Auto-hearted based on your playtime',
        );
    });

    it('does NOT show tooltip when source is manual', () => {
        vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
            wantToPlay: true,
            count: 1,
            source: 'manual',
            players: [],
            isLoading: false,
            toggle: vi.fn(),
            isToggling: false,
        });

        renderDetailPage();

        const heartButton = screen.getByRole('button', { name: /remove from list/i });
        expect(heartButton).not.toHaveAttribute('title');
    });

    it('does NOT show tooltip when source is undefined (not hearted)', () => {
        vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
            wantToPlay: false,
            count: 0,
            source: undefined,
            players: [],
            isLoading: false,
            toggle: vi.fn(),
            isToggling: false,
        });

        renderDetailPage();

        const heartButton = screen.getByRole('button', { name: /want to play/i });
        expect(heartButton).not.toHaveAttribute('title');
    });

    it('does NOT show tooltip when source is steam', () => {
        vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
            wantToPlay: true,
            count: 2,
            source: 'steam',
            players: [],
            isLoading: false,
            toggle: vi.fn(),
            isToggling: false,
        });

        renderDetailPage();

        const heartButton = screen.getByRole('button', { name: /remove from list/i });
        // 'steam' source should not get the auto-heart tooltip
        expect(heartButton.title).not.toBe('Auto-hearted based on your playtime');
    });

    // ── Button text (regression) ─────────────────────────────────────────────

    it('shows "Remove from List" when wantToPlay is true', () => {
        vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
            wantToPlay: true,
            count: 1,
            source: 'discord',
            players: [],
            isLoading: false,
            toggle: vi.fn(),
            isToggling: false,
        });

        renderDetailPage();
        expect(screen.getByRole('button', { name: /remove from list/i })).toBeInTheDocument();
    });

    it('shows "Want to Play" when wantToPlay is false', () => {
        vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
            wantToPlay: false,
            count: 0,
            source: undefined,
            players: [],
            isLoading: false,
            toggle: vi.fn(),
            isToggling: false,
        });

        renderDetailPage();
        expect(screen.getByRole('button', { name: /want to play/i })).toBeInTheDocument();
    });

    // ── Heart button not rendered when not authenticated ─────────────────────

    it('does not render the heart button when user is not authenticated', () => {
        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: null,
            isAuthenticated: false,
        } as ReturnType<typeof useAuthHook.useAuth>);

        vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
            wantToPlay: false,
            count: 0,
            source: undefined,
            players: [],
            isLoading: false,
            toggle: vi.fn(),
            isToggling: false,
        });

        renderDetailPage();

        expect(screen.queryByRole('button', { name: /want to play/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /remove from list/i })).not.toBeInTheDocument();
    });
});

// ─── GameDetailPage — loading and error states (regression) ─────────────────

describe('GameDetailPage — loading and error states', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: { id: 1, username: 'Tester', role: 'member' } as never,
            isAuthenticated: true,
        } as ReturnType<typeof useAuthHook.useAuth>);
        vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
            wantToPlay: false,
            count: 0,
            source: undefined,
            players: [],
            isLoading: false,
            toggle: vi.fn(),
            isToggling: false,
        });
    });

    it('shows loading skeleton when game data is loading', () => {
        vi.mocked(useGamesDiscoverModule.useGameDetail).mockReturnValue({
            data: undefined,
            isLoading: true,
            error: null,
        } as ReturnType<typeof useGamesDiscoverModule.useGameDetail>);

        const { container } = renderDetailPage();
        // Skeleton has animate-pulse class
        expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('shows error state when game is not found', () => {
        vi.mocked(useGamesDiscoverModule.useGameDetail).mockReturnValue({
            data: undefined,
            isLoading: false,
            error: new Error('Not found'),
        } as ReturnType<typeof useGamesDiscoverModule.useGameDetail>);

        renderDetailPage();
        expect(screen.getByText(/game not found/i)).toBeInTheDocument();
    });

    it('renders game name when data is available', () => {
        vi.mocked(useGamesDiscoverModule.useGameDetail).mockReturnValue({
            data: mockGame,
            isLoading: false,
            error: null,
        } as ReturnType<typeof useGamesDiscoverModule.useGameDetail>);

        renderDetailPage();
        expect(screen.getByText('Valheim')).toBeInTheDocument();
    });
});
