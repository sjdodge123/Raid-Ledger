/**
 * Tests for inline player stats grouping on game detail page (ROK-803).
 * Verifies that interested/owns/wishlisted stats are in a single row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GameDetailPage } from './game-detail-page';

// ─── Module mocks ────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────

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

const mockOwners = [
    { id: 1, username: 'P1', avatar: null, customAvatarUrl: null, discordId: '1' },
];
const mockWishlisters = [
    { id: 2, username: 'P2', avatar: null, customAvatarUrl: null, discordId: '2' },
];

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

// ─── Tests ───────────────────────────────────────────────────────────────

describe('GameDetailPage — inline player stats (ROK-803)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useGamesDiscoverModule.useGameDetail).mockReturnValue({
            data: mockGame,
            isLoading: false,
            error: null,
        } as ReturnType<typeof useGamesDiscoverModule.useGameDetail>);

        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: { id: 1, username: 'Tester', role: 'member' } as never,
            isAuthenticated: true,
        } as ReturnType<typeof useAuthHook.useAuth>);
    });

    it('renders player stats container when authenticated', () => {
        vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
            wantToPlay: true,
            count: 3,
            source: 'manual',
            players: [],
            owners: mockOwners,
            ownerCount: 1,
            wishlisters: mockWishlisters,
            wishlistedCount: 1,
            isLoading: false,
            toggle: vi.fn(),
            isToggling: false,
        });

        renderDetailPage();

        const container = screen.getByTestId('player-stats-row');
        expect(container).toBeInTheDocument();
    });

    it('groups owns and wishlisted stats within the same container', () => {
        vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
            wantToPlay: false,
            count: 0,
            source: undefined,
            players: [],
            owners: mockOwners,
            ownerCount: 2,
            wishlisters: mockWishlisters,
            wishlistedCount: 3,
            isLoading: false,
            toggle: vi.fn(),
            isToggling: false,
        });

        renderDetailPage();

        const container = screen.getByTestId('player-stats-row');
        // Both owner and wishlist text should be inside the container
        expect(container.textContent).toContain('own');
        expect(container.textContent).toContain('wishlisted');
    });
});
