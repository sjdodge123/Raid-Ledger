/**
 * Unit tests for the CommunityActivitySection in GameDetailPage (ROK-443/ROK-549).
 * Tests the game activity display including period selector, loading state,
 * empty/hidden state, now-playing section, top players, and playtime formatting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GameDetailPage } from './game-detail-page';
import * as useGamesDiscoverHook from '../hooks/use-games-discover';
import * as useEventsHook from '../hooks/use-events';
import * as useWantToPlayHook from '../hooks/use-want-to-play';
import type { GameTopPlayerDto, NowPlayingPlayerDto } from '@raid-ledger/contract';

// Mock the hooks used by the page
vi.mock('../hooks/use-games-discover');
vi.mock('../hooks/use-events');
vi.mock('../hooks/use-want-to-play');
vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({ user: null, isLoading: false, isAuthenticated: false }),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

const createMockTopPlayer = (overrides: Partial<GameTopPlayerDto> = {}): GameTopPlayerDto => ({
    userId: 1,
    username: 'PlayerOne',
    avatar: 'abc123',
    customAvatarUrl: null,
    discordId: '111',
    totalSeconds: 7200,
    ...overrides,
});

const createMockNowPlaying = (overrides: Partial<NowPlayingPlayerDto> = {}): NowPlayingPlayerDto => ({
    userId: 10,
    username: 'ActivePlayer',
    avatar: 'def456',
    customAvatarUrl: null,
    discordId: '222',
    ...overrides,
});

/** Minimal game detail to render the page past the loading/error gates. */
const mockGameDetail = {
    id: 42,
    igdbId: 42,
    name: 'Valheim',
    slug: 'valheim',
    coverUrl: 'https://example.com/cover.jpg',
    genres: [],
    themes: [],
    gameModes: [],
    platforms: [],
    summary: 'A Viking survival game.',
    rating: 80,
    aggregatedRating: 85,
    screenshots: [],
    videos: [],
    firstReleaseDate: null,
    playerCount: null,
    crossplay: null,
};

function renderGameDetailPage(gameId = '42') {
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

// ─── Default mock setup ───────────────────────────────────────────────────────

function setupDefaultMocks(
    activityOptions?: {
        topPlayers?: GameTopPlayerDto[];
        totalSeconds?: number;
        isLoading?: boolean;
    },
    nowPlayingOptions?: {
        players?: NowPlayingPlayerDto[];
        count?: number;
    },
) {
    vi.spyOn(useGamesDiscoverHook, 'useGameDetail').mockReturnValue({
        data: mockGameDetail,
        isLoading: false,
        error: null,
    } as never);

    vi.spyOn(useGamesDiscoverHook, 'useGameStreams').mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
    } as never);

    vi.spyOn(useEventsHook, 'useEvents').mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
    } as never);

    vi.spyOn(useWantToPlayHook, 'useWantToPlay').mockReturnValue({
        wantToPlay: false,
        count: 0,
        source: undefined,
        players: [],
        toggle: vi.fn(),
        isToggling: false,
    } as never);

    vi.spyOn(useGamesDiscoverHook, 'useGameActivity').mockReturnValue({
        data: activityOptions ? {
            topPlayers: activityOptions.topPlayers ?? [],
            totalSeconds: activityOptions.totalSeconds ?? 0,
            period: 'week' as const,
        } : undefined,
        isLoading: activityOptions?.isLoading ?? false,
        error: null,
    } as never);

    vi.spyOn(useGamesDiscoverHook, 'useGameNowPlaying').mockReturnValue({
        data: nowPlayingOptions ? {
            players: nowPlayingOptions.players ?? [],
            count: nowPlayingOptions.count ?? 0,
        } : { players: [], count: 0 },
        isLoading: false,
        error: null,
    } as never);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GameDetailPage — CommunityActivitySection (ROK-443)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('section rendering', () => {
        it('renders the Community Activity heading when there is data', () => {
            setupDefaultMocks(
                { topPlayers: [createMockTopPlayer()], totalSeconds: 7200 },
            );

            renderGameDetailPage();

            expect(screen.getByText('Community Activity')).toBeInTheDocument();
        });

        it('renders period selector buttons: This Week, This Month, All Time', () => {
            setupDefaultMocks(
                { topPlayers: [createMockTopPlayer()], totalSeconds: 7200 },
            );

            renderGameDetailPage();

            expect(screen.getByRole('button', { name: 'This Week' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'This Month' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'All Time' })).toBeInTheDocument();
        });
    });

    describe('hidden when empty', () => {
        it('does not render the section when there is no data', () => {
            setupDefaultMocks(
                { topPlayers: [], totalSeconds: 0 },
                { players: [], count: 0 },
            );

            renderGameDetailPage();

            expect(screen.queryByText('Community Activity')).not.toBeInTheDocument();
        });
    });

    describe('loading state', () => {
        it('shows loading skeletons when activity is loading', () => {
            setupDefaultMocks(
                { topPlayers: [], totalSeconds: 0, isLoading: true },
                { players: [createMockNowPlaying()], count: 1 },
            );

            const { container } = renderGameDetailPage();

            const skeletons = container.querySelectorAll('.animate-pulse');
            expect(skeletons.length).toBeGreaterThan(0);
        });
    });

    describe('now playing', () => {
        it('shows now-playing count when players are active', () => {
            setupDefaultMocks(
                { topPlayers: [createMockTopPlayer()], totalSeconds: 7200 },
                { players: [createMockNowPlaying()], count: 1 },
            );

            renderGameDetailPage();

            expect(screen.getByText('1 playing now')).toBeInTheDocument();
        });

        it('shows correct count for multiple active players', () => {
            setupDefaultMocks(
                { topPlayers: [createMockTopPlayer()], totalSeconds: 7200 },
                {
                    players: [
                        createMockNowPlaying({ userId: 10, username: 'Player1' }),
                        createMockNowPlaying({ userId: 11, username: 'Player2' }),
                        createMockNowPlaying({ userId: 12, username: 'Player3' }),
                    ],
                    count: 3,
                },
            );

            renderGameDetailPage();

            expect(screen.getByText('3 playing now')).toBeInTheDocument();
        });

        it('does not show now-playing section when count is 0', () => {
            setupDefaultMocks(
                { topPlayers: [createMockTopPlayer()], totalSeconds: 7200 },
                { players: [], count: 0 },
            );

            renderGameDetailPage();

            expect(screen.queryByText(/playing now/)).not.toBeInTheDocument();
        });

        it('links now-playing avatars to user profiles', () => {
            setupDefaultMocks(
                { topPlayers: [createMockTopPlayer()], totalSeconds: 7200 },
                { players: [createMockNowPlaying({ userId: 99 })], count: 1 },
            );

            renderGameDetailPage();

            const links = screen.getAllByRole('link');
            const playerLink = links.find(l => l.getAttribute('href') === '/users/99');
            expect(playerLink).toBeTruthy();
        });
    });

    describe('community playtime', () => {
        it('shows total community playtime formatted', () => {
            setupDefaultMocks(
                { topPlayers: [createMockTopPlayer()], totalSeconds: 7200 },
            );

            renderGameDetailPage();

            expect(screen.getByText('2h total community playtime')).toBeInTheDocument();
        });

        it('shows hours and minutes for non-round values', () => {
            setupDefaultMocks(
                { topPlayers: [createMockTopPlayer()], totalSeconds: 5400 },
            );

            renderGameDetailPage();

            expect(screen.getByText('1h 30m total community playtime')).toBeInTheDocument();
        });

        it('does not show playtime when totalSeconds is 0', () => {
            setupDefaultMocks(
                { topPlayers: [], totalSeconds: 0 },
                { players: [createMockNowPlaying()], count: 1 },
            );

            renderGameDetailPage();

            expect(screen.queryByText(/total community playtime/)).not.toBeInTheDocument();
        });
    });

    describe('top players', () => {
        it('renders player names in the leaderboard', () => {
            const players = [
                createMockTopPlayer({ userId: 1, username: 'TopPlayer', totalSeconds: 10000 }),
                createMockTopPlayer({ userId: 2, username: 'RunnerUp', totalSeconds: 5000 }),
            ];
            setupDefaultMocks({ topPlayers: players, totalSeconds: 15000 });

            renderGameDetailPage();

            expect(screen.getByText('TopPlayer')).toBeInTheDocument();
            expect(screen.getByText('RunnerUp')).toBeInTheDocument();
        });

        it('renders rank numbers for top players', () => {
            const players = [
                createMockTopPlayer({ userId: 1, username: 'First', totalSeconds: 10000 }),
                createMockTopPlayer({ userId: 2, username: 'Second', totalSeconds: 5000 }),
            ];
            setupDefaultMocks({ topPlayers: players, totalSeconds: 15000 });

            renderGameDetailPage();

            expect(screen.getByText('#1')).toBeInTheDocument();
            expect(screen.getByText('#2')).toBeInTheDocument();
        });

        it('renders formatted playtime for each player', () => {
            const players = [
                createMockTopPlayer({ userId: 1, username: 'HeavyPlayer', totalSeconds: 7200 }),
            ];
            setupDefaultMocks({ topPlayers: players, totalSeconds: 7200 });

            renderGameDetailPage();

            // "2h" appears both as player's time and total community playtime
            const twoHourTexts = screen.getAllByText('2h');
            expect(twoHourTexts.length).toBeGreaterThanOrEqual(1);
        });

        it('links each player row to their profile', () => {
            const players = [
                createMockTopPlayer({ userId: 77, username: 'LinkedPlayer', totalSeconds: 3600 }),
            ];
            setupDefaultMocks({ topPlayers: players, totalSeconds: 3600 });

            renderGameDetailPage();

            const link = screen.getByRole('link', { name: /LinkedPlayer/i });
            expect(link).toHaveAttribute('href', '/users/77');
        });

        it('renders player playtime in minutes for sub-hour entries', () => {
            const players = [
                createMockTopPlayer({ userId: 1, username: 'QuickPlayer', totalSeconds: 1800 }),
            ];
            setupDefaultMocks({ topPlayers: players, totalSeconds: 1800 });

            renderGameDetailPage();

            expect(screen.getByText('30m')).toBeInTheDocument();
        });
    });

    describe('period selector', () => {
        it('calls useGameActivity with initial period week', () => {
            setupDefaultMocks({ topPlayers: [], totalSeconds: 0 });

            renderGameDetailPage();

            expect(useGamesDiscoverHook.useGameActivity).toHaveBeenCalledWith(42, 'week');
        });

        it('changes period when This Month is clicked', async () => {
            const user = userEvent.setup();
            setupDefaultMocks(
                { topPlayers: [createMockTopPlayer()], totalSeconds: 7200 },
            );

            renderGameDetailPage();

            await user.click(screen.getByRole('button', { name: 'This Month' }));

            expect(useGamesDiscoverHook.useGameActivity).toHaveBeenCalledWith(42, 'month');
        });

        it('changes period when All Time is clicked', async () => {
            const user = userEvent.setup();
            setupDefaultMocks(
                { topPlayers: [createMockTopPlayer()], totalSeconds: 7200 },
            );

            renderGameDetailPage();

            await user.click(screen.getByRole('button', { name: 'All Time' }));

            expect(useGamesDiscoverHook.useGameActivity).toHaveBeenCalledWith(42, 'all');
        });
    });
});
