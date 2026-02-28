/**
 * Unit tests for the ActivitySection in UserProfilePage (ROK-443).
 * Tests the game activity display including period selector, loading state,
 * empty state, Most Played badge, and game links.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { UserProfilePage } from './user-profile-page';
import * as useUserProfileHook from '../hooks/use-user-profile';
import * as useGameRegistryHook from '../hooks/use-game-registry';
import type { UserProfileDto, GameActivityEntryDto } from '@raid-ledger/contract';

// Mock the hooks used by the page
vi.mock('../hooks/use-user-profile');
vi.mock('../hooks/use-game-registry');
vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({ user: null, isLoading: false, isAuthenticated: false }),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

const createMockProfile = (overrides: Partial<UserProfileDto> = {}): UserProfileDto => ({
    id: 1,
    username: 'TestUser',
    avatar: null,
    customAvatarUrl: null,
    discordId: null,
    characters: [],
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
});

const createMockActivityEntry = (overrides: Partial<GameActivityEntryDto> = {}): GameActivityEntryDto => ({
    gameId: 1,
    gameName: 'Valheim',
    coverUrl: 'https://example.com/cover.jpg',
    totalSeconds: 7200,
    isMostPlayed: false,
    ...overrides,
});

function renderUserProfilePage(userId = '1') {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[`/users/${userId}`]}>
                <Routes>
                    <Route path="/users/:userId" element={<UserProfilePage />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

// ─── Default mock setup ───────────────────────────────────────────────────────

function setupDefaultMocks(
    activityData?: { data: GameActivityEntryDto[]; period: 'week' | 'month' | 'all' } | null,
    isLoading = false,
) {
    vi.spyOn(useGameRegistryHook, 'useGameRegistry').mockReturnValue({
        games: [],
        isLoading: false,
        error: null,
    } as never);

    vi.spyOn(useUserProfileHook, 'useUserHeartedGames').mockReturnValue({
        data: { data: [] },
        isLoading: false,
        error: null,
    } as never);

    vi.spyOn(useUserProfileHook, 'useUserEventSignups').mockReturnValue({
        data: { data: [], total: 0 },
        isLoading: false,
        error: null,
    } as never);

    vi.spyOn(useUserProfileHook, 'useUserActivity').mockReturnValue({
        data: activityData ?? undefined,
        isLoading,
        error: null,
    } as never);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UserProfilePage — ActivitySection (ROK-443)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('section rendering', () => {
        it('renders the Game Activity section heading', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);
            setupDefaultMocks({ data: [], period: 'week' });

            renderUserProfilePage();

            expect(screen.getByText('Game Activity')).toBeInTheDocument();
        });

        it('renders period selector buttons: This Week, This Month, All Time', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);
            setupDefaultMocks({ data: [], period: 'week' });

            renderUserProfilePage();

            expect(screen.getByRole('button', { name: 'This Week' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'This Month' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'All Time' })).toBeInTheDocument();
        });
    });

    describe('empty state', () => {
        it('shows empty state message when there is no activity', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);
            setupDefaultMocks({ data: [], period: 'week' });

            renderUserProfilePage();

            expect(screen.getByText('No activity tracked yet.')).toBeInTheDocument();
        });

        it('shows empty state when data is undefined', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);
            setupDefaultMocks(null);

            renderUserProfilePage();

            expect(screen.getByText('No activity tracked yet.')).toBeInTheDocument();
        });
    });

    describe('loading state', () => {
        it('shows loading skeletons when activity is loading', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);
            setupDefaultMocks(null, true);

            const { container } = renderUserProfilePage();

            // Pulse skeletons should appear
            const skeletons = container.querySelectorAll('.animate-pulse');
            expect(skeletons.length).toBeGreaterThan(0);
        });
    });

    describe('activity entries', () => {
        it('renders game name for each activity entry', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);

            const entries = [
                createMockActivityEntry({ gameId: 1, gameName: 'Valheim', isMostPlayed: true }),
                createMockActivityEntry({ gameId: 2, gameName: 'Elden Ring', isMostPlayed: false }),
            ];
            setupDefaultMocks({ data: entries, period: 'week' });

            renderUserProfilePage();

            expect(screen.getByText('Valheim')).toBeInTheDocument();
            expect(screen.getByText('Elden Ring')).toBeInTheDocument();
        });

        it('renders playtime as formatted string', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);

            const entries = [
                createMockActivityEntry({ gameId: 1, gameName: 'Valheim', totalSeconds: 7200, isMostPlayed: true }),
            ];
            setupDefaultMocks({ data: entries, period: 'week' });

            renderUserProfilePage();

            // 7200 seconds = 2 hours
            expect(screen.getByText('2h')).toBeInTheDocument();
        });

        it('renders playtime with hours and minutes', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);

            const entries = [
                createMockActivityEntry({ gameId: 1, gameName: 'Test Game', totalSeconds: 5400, isMostPlayed: true }),
            ];
            setupDefaultMocks({ data: entries, period: 'week' });

            renderUserProfilePage();

            // 5400 seconds = 1h 30m
            expect(screen.getByText('1h 30m')).toBeInTheDocument();
        });

        it('renders playtime in minutes only for sub-hour entries', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);

            const entries = [
                createMockActivityEntry({ gameId: 1, gameName: 'Quick Game', totalSeconds: 1800, isMostPlayed: true }),
            ];
            setupDefaultMocks({ data: entries, period: 'week' });

            renderUserProfilePage();

            // 1800 seconds = 30m
            expect(screen.getByText('30m')).toBeInTheDocument();
        });

        it('shows Most Played badge on first entry', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);

            const entries = [
                createMockActivityEntry({ gameId: 1, gameName: 'Top Game', isMostPlayed: true }),
                createMockActivityEntry({ gameId: 2, gameName: 'Second Game', isMostPlayed: false }),
            ];
            setupDefaultMocks({ data: entries, period: 'week' });

            renderUserProfilePage();

            expect(screen.getByText('Most Played')).toBeInTheDocument();
        });

        it('does not show Most Played badge when isMostPlayed is false', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);

            const entries = [
                createMockActivityEntry({ gameId: 1, gameName: 'Only Game', isMostPlayed: false }),
            ];
            setupDefaultMocks({ data: entries, period: 'week' });

            renderUserProfilePage();

            expect(screen.queryByText('Most Played')).not.toBeInTheDocument();
        });

        it('links each activity entry to the game detail page', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);

            const entries = [
                createMockActivityEntry({ gameId: 42, gameName: 'Linked Game', isMostPlayed: true }),
            ];
            setupDefaultMocks({ data: entries, period: 'week' });

            renderUserProfilePage();

            const link = screen.getByRole('link', { name: /Linked Game/i });
            expect(link).toHaveAttribute('href', '/games/42');
        });

        it('shows placeholder box when coverUrl is null', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);

            const entries = [
                createMockActivityEntry({ gameId: 1, gameName: 'No Cover', coverUrl: null, isMostPlayed: true }),
            ];
            setupDefaultMocks({ data: entries, period: 'week' });

            renderUserProfilePage();

            // Should render the "?" placeholder
            expect(screen.getByText('?')).toBeInTheDocument();
        });

        it('shows game cover image when coverUrl is present', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);

            const entries = [
                createMockActivityEntry({
                    gameId: 1,
                    gameName: 'Covered Game',
                    coverUrl: 'https://example.com/cover.jpg',
                    isMostPlayed: true,
                }),
            ];
            setupDefaultMocks({ data: entries, period: 'week' });

            renderUserProfilePage();

            const img = screen.getByAltText('Covered Game');
            expect(img).toBeInTheDocument();
            expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg');
        });
    });

    describe('period selector', () => {
        it('calls useUserActivity with the correct period initially (week)', () => {
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);
            const activitySpy = setupDefaultMocks({ data: [], period: 'week' });
            void activitySpy;

            renderUserProfilePage();

            // Verify the initial call was with period=week
            expect(useUserProfileHook.useUserActivity).toHaveBeenCalledWith(1, 'week');
        });

        it('changes period when a different button is clicked', async () => {
            const user = userEvent.setup();
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);
            setupDefaultMocks({ data: [], period: 'week' });

            renderUserProfilePage();

            await user.click(screen.getByRole('button', { name: 'This Month' }));

            expect(useUserProfileHook.useUserActivity).toHaveBeenCalledWith(1, 'month');
        });

        it('changes period to All Time', async () => {
            const user = userEvent.setup();
            const profile = createMockProfile();
            vi.spyOn(useUserProfileHook, 'useUserProfile').mockReturnValue({
                data: profile,
                isLoading: false,
                error: null,
            } as never);
            setupDefaultMocks({ data: [], period: 'week' });

            renderUserProfilePage();

            await user.click(screen.getByRole('button', { name: 'All Time' }));

            expect(useUserProfileHook.useUserActivity).toHaveBeenCalledWith(1, 'all');
        });
    });
});
