import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GamesStep } from './games-step';

vi.mock('../../hooks/use-games-discover', () => ({
    useGamesDiscover: vi.fn(() => ({
        data: {
            rows: [
                {
                    title: 'Popular Games',
                    games: [
                        {
                            id: 1,
                            name: 'World of Warcraft',
                            slug: 'wow',
                            coverUrl: null,
                            genres: [36],
                            gameModes: [],
                            summary: null,
                            rating: null,
                            aggregatedRating: null,
                            popularity: null,
                            themes: [],
                            platforms: [],
                            screenshots: [],
                            videos: [],
                            firstReleaseDate: null,
                            playerCount: null,
                            twitchGameId: null,
                            crossplay: null,
                        },
                        {
                            id: 2,
                            name: 'Counter-Strike',
                            slug: 'cs2',
                            coverUrl: null,
                            genres: [5],
                            gameModes: [],
                            summary: null,
                            rating: null,
                            aggregatedRating: null,
                            popularity: null,
                            themes: [],
                            platforms: [],
                            screenshots: [],
                            videos: [],
                            firstReleaseDate: null,
                            playerCount: null,
                            twitchGameId: null,
                            crossplay: null,
                        },
                    ],
                },
            ],
        },
        isLoading: false,
    })),
}));

vi.mock('../../hooks/use-game-search', () => ({
    useGameSearch: vi.fn(() => ({
        data: null,
        isLoading: false,
    })),
}));

vi.mock('../../hooks/use-want-to-play', () => ({
    useWantToPlay: vi.fn(() => ({
        wantToPlay: false,
        count: 0,
        toggle: vi.fn(),
        isToggling: false,
    })),
}));

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({
        isAuthenticated: true,
    })),
    getAuthToken: () => 'test-token',
}));

import { useGameSearch } from '../../hooks/use-game-search';
import { useGamesDiscover } from '../../hooks/use-games-discover';

const mockUseGameSearch = useGameSearch as unknown as ReturnType<typeof vi.fn>;
const mockUseGamesDiscover = useGamesDiscover as unknown as ReturnType<typeof vi.fn>;

function createQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            {ui}
        </QueryClientProvider>
    );
}

const DEFAULT_DISCOVER_DATA = {
    data: {
        rows: [
            {
                title: 'Popular Games',
                games: [
                    {
                        id: 1,
                        name: 'World of Warcraft',
                        slug: 'wow',
                        coverUrl: null,
                        genres: [36],
                        gameModes: [],
                        summary: null,
                        rating: null,
                        aggregatedRating: null,
                        popularity: null,
                        themes: [],
                        platforms: [],
                        screenshots: [],
                        videos: [],
                        firstReleaseDate: null,
                        playerCount: null,
                        twitchGameId: null,
                        crossplay: null,
                    },
                    {
                        id: 2,
                        name: 'Counter-Strike',
                        slug: 'cs2',
                        coverUrl: null,
                        genres: [5],
                        gameModes: [],
                        summary: null,
                        rating: null,
                        aggregatedRating: null,
                        popularity: null,
                        themes: [],
                        platforms: [],
                        screenshots: [],
                        videos: [],
                        firstReleaseDate: null,
                        playerCount: null,
                        twitchGameId: null,
                        crossplay: null,
                    },
                ],
            },
        ],
    },
    isLoading: false,
};

describe('GamesStep', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Restore default mock implementations after each test
        mockUseGamesDiscover.mockReturnValue(DEFAULT_DISCOVER_DATA);
        mockUseGameSearch.mockReturnValue({ data: null, isLoading: false });
    });

    describe('Rendering', () => {
        it('renders the "What Do You Play?" heading', () => {
            renderWithProviders(<GamesStep />);
            expect(screen.getByText(/what do you play\?/i)).toBeInTheDocument();
        });

        it('renders the search input', () => {
            renderWithProviders(<GamesStep />);
            expect(screen.getByPlaceholderText(/search for a game/i)).toBeInTheDocument();
        });

        it('renders genre filter chips', () => {
            renderWithProviders(<GamesStep />);
            // Genre chips are <button> elements inside the flex-wrap gap-2 container
            // Use getAllByRole to handle multiple matching elements (game cards also have role=button)
            const mmorpgButtons = screen.getAllByRole('button', { name: /mmorpg/i });
            // At least the genre chip should be there
            expect(mmorpgButtons.length).toBeGreaterThan(0);
            expect(screen.getAllByRole('button', { name: /shooter/i }).length).toBeGreaterThan(0);
            expect(screen.getAllByRole('button', { name: /rpg/i }).length).toBeGreaterThan(0);
        });

        it('renders an "All" genre chip', () => {
            renderWithProviders(<GamesStep />);
            expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument();
        });
    });

    describe('Touch target compliance (min-h-[44px])', () => {
        it('search input has min-h-[44px] for touch target compliance', () => {
            const { container } = renderWithProviders(<GamesStep />);
            const searchInput = container.querySelector('input[placeholder="Search for a game..."]');
            expect(searchInput).not.toBeNull();
            expect(searchInput!.className).toContain('min-h-[44px]');
        });

        it('"All" genre chip has min-h-[44px]', () => {
            renderWithProviders(<GamesStep />);
            const allButton = screen.getByRole('button', { name: /^all$/i });
            expect(allButton.className).toContain('min-h-[44px]');
        });

        it('genre filter chips have min-h-[44px]', () => {
            const { container } = renderWithProviders(<GamesStep />);
            // Genre chip buttons are inside the flex-wrap genre container
            const genreContainer = container.querySelector('.flex.flex-wrap.gap-2');
            expect(genreContainer).not.toBeNull();
            // Find the MMORPG button (an actual <button> not a div[role=button])
            const mmorpgChip = Array.from(genreContainer!.querySelectorAll('button')).find(
                (b) => b.textContent === 'MMORPG'
            );
            expect(mmorpgChip).not.toBeNull();
            expect(mmorpgChip!.className).toContain('min-h-[44px]');
        });

        it('all genre chips have min-h-[44px]', () => {
            const { container } = renderWithProviders(<GamesStep />);
            // Genre chips container
            const genreButtons = container.querySelectorAll('.flex.flex-wrap.gap-2 button');
            expect(genreButtons.length).toBeGreaterThan(0);
            genreButtons.forEach((btn) => {
                expect(btn.className).toContain('min-h-[44px]');
            });
        });
    });

    describe('Genre filtering', () => {
        it('shows all games when "All" is selected', () => {
            renderWithProviders(<GamesStep />);
            expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
            expect(screen.getByText('Counter-Strike')).toBeInTheDocument();
        });

        it('filters games by MMORPG genre chip', () => {
            const { container } = renderWithProviders(<GamesStep />);
            // Find the MMORPG <button> chip inside the genre container (not div[role=button])
            const genreContainer = container.querySelector('.flex.flex-wrap.gap-2');
            const mmorpgChip = Array.from(genreContainer!.querySelectorAll('button')).find(
                (b) => b.textContent === 'MMORPG'
            )!;
            fireEvent.click(mmorpgChip);
            // WoW (genre 36 = MMORPG) should still be visible
            expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
            // Counter-Strike (genre 5 = Shooter) should be filtered out
            expect(screen.queryByText('Counter-Strike')).not.toBeInTheDocument();
        });

        it('deselects genre filter when clicked again', () => {
            const { container } = renderWithProviders(<GamesStep />);
            const genreContainer = container.querySelector('.flex.flex-wrap.gap-2');
            const mmorpgChip = Array.from(genreContainer!.querySelectorAll('button')).find(
                (b) => b.textContent === 'MMORPG'
            )!;
            fireEvent.click(mmorpgChip);
            fireEvent.click(mmorpgChip);
            // Both games visible again
            expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
            expect(screen.getByText('Counter-Strike')).toBeInTheDocument();
        });

        it('hides genre chips when search query is active', () => {
            renderWithProviders(<GamesStep />);
            const searchInput = screen.getByPlaceholderText(/search for a game/i);
            fireEvent.change(searchInput, { target: { value: 'world' } });
            expect(screen.queryByRole('button', { name: /mmorpg/i })).not.toBeInTheDocument();
        });
    });

    describe('Search', () => {
        it('updates search query when user types', () => {
            renderWithProviders(<GamesStep />);
            const searchInput = screen.getByPlaceholderText(/search for a game/i) as HTMLInputElement;
            fireEvent.change(searchInput, { target: { value: 'test' } });
            expect(searchInput.value).toBe('test');
        });

        it('shows empty state when no games found in search', () => {
            mockUseGameSearch.mockReturnValue({ data: { data: [] }, isLoading: false });

            renderWithProviders(<GamesStep />);
            const searchInput = screen.getByPlaceholderText(/search for a game/i);
            fireEvent.change(searchInput, { target: { value: 'xyznotfound' } });

            // With 2+ chars we trigger search mode; data is empty → show empty message
            expect(screen.getByText(/no games found/i)).toBeInTheDocument();
        });
    });

    describe('Loading state', () => {
        it('shows loading spinner while fetching discover data', () => {
            mockUseGamesDiscover.mockReturnValue({ data: null, isLoading: true });

            renderWithProviders(<GamesStep />);
            expect(screen.getByText(/loading games/i)).toBeInTheDocument();
        });
    });

    describe('Responsive grid', () => {
        it('game grid uses grid-cols-2 base and sm:grid-cols-3', () => {
            const { container } = renderWithProviders(<GamesStep />);
            // querySelector does not handle Tailwind responsive prefixes well.
            // We verify by finding the grid element and checking its className attribute.
            const grid = container.querySelector('.grid.grid-cols-2');
            expect(grid).not.toBeNull();
            expect(grid!.className).toContain('sm:grid-cols-3');
        });
    });
});
