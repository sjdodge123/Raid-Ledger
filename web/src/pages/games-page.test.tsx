/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GamesPage } from './games-page';
import * as useGamesDiscoverModule from '../hooks/use-games-discover';
import * as useGameSearchModule from '../hooks/use-game-search';

// Mock hooks
vi.mock('../hooks/use-games-discover');
vi.mock('../hooks/use-game-search');

vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({ user: null, isAuthenticated: false }),
    isOperatorOrAdmin: () => false,
}));

vi.mock('../hooks/use-debounced-value', () => ({
    useDebouncedValue: (value: string) => value,
}));

vi.mock('../hooks/use-scroll-direction', () => ({
    useScrollDirection: () => 'up',
}));

// Prevent rendering complex child components
vi.mock('../components/games/GameCarousel', () => ({
    GameCarousel: ({ category }: { category: string }) => <div data-testid="game-carousel">{category}</div>,
}));

vi.mock('../components/games/GameCard', () => ({
    GameCard: ({ game }: { game: { name: string } }) => <div data-testid="game-card">{game.name}</div>,
}));

vi.mock('../components/games/mobile-game-card', () => ({
    MobileGameCard: ({ game }: { game: { name: string } }) => <div data-testid="mobile-game-card">{game.name}</div>,
}));

vi.mock('../components/admin/GameLibraryTable', () => ({
    GameLibraryTable: () => <div data-testid="game-library-table" />,
}));

vi.mock('../components/games/games-mobile-toolbar', () => ({
    GamesMobileToolbar: () => <div data-testid="games-mobile-toolbar" />,
}));

vi.mock('../hooks/use-want-to-play-batch', () => ({
    WantToPlayProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockGame = {
    id: 1,
    igdbId: 100,
    name: 'Warcraft',
    slug: 'warcraft',
    coverUrl: null,
    genres: [12], // RPG
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

const mockDiscoverData = {
    rows: [
        { slug: 'row-1', category: 'Popular RPGs', games: [mockGame] },
        { slug: 'row-2', category: 'Top Shooters', games: [{ ...mockGame, id: 2, name: 'Shooter Game', genres: [5] }] },
    ],
};

function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <GamesPage />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

function mockDiscover(data: typeof mockDiscoverData | null = mockDiscoverData) {
    vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
        data,
        isLoading: false,
        error: null,
    } as any);
}

function mockSearch(data: any = null, isLoading = false) {
    vi.spyOn(useGameSearchModule, 'useGameSearch').mockReturnValue({
        data,
        isLoading,
        error: null,
    } as any);
}

describe('GamesPage — Genre Filter Bottom Sheet (ROK-337)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDiscover();
        mockSearch();
    });

    describe('Mobile Filter Button', () => {
        it('renders genre filter button', () => {
            renderPage();
            const filterBtn = screen.getByRole('button', { name: /genre filter/i });
            expect(filterBtn).toBeInTheDocument();
        });

        it('renders Genre Filter aria-label on the FAB', () => {
            renderPage();
            expect(screen.getByRole('button', { name: /genre filter/i })).toBeInTheDocument();
        });

        it('renders funnel icon inside the filter button', () => {
            renderPage();
            const filterBtn = screen.getByRole('button', { name: /genre filter/i });
            // FunnelIcon renders as an svg inside the button
            const svg = filterBtn.querySelector('svg');
            expect(svg).toBeInTheDocument();
        });

        it('does NOT show badge when no genre selected', () => {
            renderPage();
            const filterBtn = screen.getByRole('button', { name: /genre filter/i });
            // Badge is a span with text "1" — should not be present
            expect(filterBtn.querySelector('span.rounded-full')).not.toBeInTheDocument();
        });

        it('hides filter button when searching (search query >= 2 chars)', () => {
            // With our useDebouncedValue mock returning the value directly,
            // we need the component to have a search query >= 2 chars
            // We can check this by verifying after entering search text
            renderPage();
            const searchInput = screen.getByPlaceholderText('Search games...');
            fireEvent.change(searchInput, { target: { value: 'wa' } });

            // After entering 2+ chars, the filter button container should not be in the DOM
            expect(screen.queryByRole('button', { name: /genre filter/i })).not.toBeInTheDocument();
        });

        it('shows filter button again when search is cleared', () => {
            renderPage();
            const searchInput = screen.getByPlaceholderText('Search games...');
            fireEvent.change(searchInput, { target: { value: 'wa' } });
            expect(screen.queryByRole('button', { name: /genre filter/i })).not.toBeInTheDocument();

            fireEvent.change(searchInput, { target: { value: '' } });
            expect(screen.getByRole('button', { name: /genre filter/i })).toBeInTheDocument();
        });
    });

    describe('Desktop Genre Filter Pills', () => {
        it('renders "All" pill on desktop', () => {
            const { container } = renderPage();
            const pillsContainer = container.querySelector('.hidden.md\\:flex');
            expect(pillsContainer).not.toBeNull();
            const allButton = Array.from(pillsContainer!.querySelectorAll('button')).find(
                (btn) => btn.textContent?.trim() === 'All',
            );
            expect(allButton).toBeInTheDocument();
        });

        it('renders all 11 genre pills on desktop', () => {
            const { container } = renderPage();
            const pillsContainer = container.querySelector('.hidden.md\\:flex');
            expect(pillsContainer).not.toBeNull();
            // 1 "All" button + 11 genre buttons
            const buttons = pillsContainer!.querySelectorAll('button');
            expect(buttons.length).toBe(12);
        });
    });

    describe('Bottom Sheet behavior', () => {
        it('bottom sheet has title "Genre Filter"', () => {
            renderPage();
            const filterBtn = screen.getByRole('button', { name: /genre filter/i });
            fireEvent.click(filterBtn);

            // The bottom sheet title renders as an h3 element
            const dialog = screen.getByRole('dialog');
            const title = dialog.querySelector('h3');
            expect(title?.textContent).toBe('Genre Filter');
        });

        it('renders "All" option in bottom sheet', () => {
            renderPage();
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));

            // Inside the dialog, there should be an "All" button
            const dialog = screen.getByRole('dialog');
            const allButton = Array.from(dialog.querySelectorAll('button')).find(
                (btn) => btn.textContent?.includes('All'),
            );
            expect(allButton).toBeInTheDocument();
        });

        it('renders all 11 genre rows in bottom sheet', () => {
            const genreLabels = ['RPG', 'Shooter', 'Adventure', 'Strategy', 'Simulator', 'Sport', 'Racing', 'Fighting', 'Indie', 'MMORPG', 'MOBA'];

            renderPage();
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));

            const dialog = screen.getByRole('dialog');
            for (const label of genreLabels) {
                const btn = Array.from(dialog.querySelectorAll('button')).find(
                    (b) => b.textContent?.includes(label),
                );
                expect(btn).toBeInTheDocument();
            }
        });

    });

    describe('Genre selection', () => {
        it('selected genre row shows checkmark icon', () => {
            renderPage();
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            const dialog = screen.getByRole('dialog');
            const rpgBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('RPG'),
            );
            fireEvent.click(rpgBtn!);

            // Reopen the sheet
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            const dialogAfter = screen.getByRole('dialog');
            const rpgBtnAfter = Array.from(dialogAfter.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('RPG'),
            );
            // CheckIcon is an SVG inside the button
            const checkIcon = rpgBtnAfter?.querySelector('svg');
            expect(checkIcon).toBeInTheDocument();
        });

        it('"All" option shows checkmark when no genre is selected (default state)', () => {
            renderPage();
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));

            const dialog = screen.getByRole('dialog');
            const allBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('All'),
            );
            // CheckIcon is an SVG
            const checkIcon = allBtn?.querySelector('svg');
            expect(checkIcon).toBeInTheDocument();
        });

        it('"All" button clears selection and shows checkmark', () => {
            renderPage();
            // First select a genre
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            const dialog = screen.getByRole('dialog');
            const rpgBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('RPG'),
            );
            fireEvent.click(rpgBtn!);

            // Now click "All" to clear
            const allBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('All'),
            );
            fireEvent.click(allBtn!);

            // "All" should now show checkmark (selected state)
            const checkIcon = allBtn?.querySelector('svg');
            expect(checkIcon).toBeInTheDocument();
        });
    });

    describe('FAB filter button', () => {
        it('renders FAB with FunnelIcon when genres are available', () => {
            renderPage();
            const filterBtn = screen.getByRole('button', { name: /genre filter/i });
            expect(filterBtn).toBeInTheDocument();
            // FAB renders an SVG icon (FunnelIcon)
            expect(filterBtn.querySelector('svg')).toBeInTheDocument();
        });

        it('selected genre is reflected inside bottom sheet, not on FAB badge', () => {
            renderPage();
            // Select a genre
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            const dialog = screen.getByRole('dialog');
            const rpgBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('RPG'),
            );
            fireEvent.click(rpgBtn!);

            // FAB should NOT contain a badge (no inline badge on FAB)
            const filterBtn = screen.getByRole('button', { name: /genre filter/i });
            expect(filterBtn.querySelector('span.rounded-full')).not.toBeInTheDocument();
        });
    });

    describe('Genre filter applied to content', () => {
        it('filters discover rows by selected genre', () => {
            renderPage();
            // Initially both carousel categories show (may appear in multiple elements due to carousel + h2 mocks)
            expect(screen.getAllByText('Popular RPGs').length).toBeGreaterThan(0);
            expect(screen.getAllByText('Top Shooters').length).toBeGreaterThan(0);

            // Select RPG (genre id 12) — mockGame has genres: [12]
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            const dialog = screen.getByRole('dialog');
            const rpgBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('RPG'),
            );
            fireEvent.click(rpgBtn!);

            // Only the RPG row should show (Shooter row game has genres [5], not [12])
            expect(screen.getAllByText('Popular RPGs').length).toBeGreaterThan(0);
            expect(screen.queryByText('Top Shooters')).not.toBeInTheDocument();
        });

        it('shows empty state message when no games match selected genre', () => {
            vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
                data: {
                    rows: [
                        { slug: 'row-1', category: 'Action', games: [{ ...mockGame, genres: [5] }] },
                    ],
                },
                isLoading: false,
                error: null,
            } as any);

            renderPage();

            // Select MOBA (genre id 36) — no games have that genre
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            const dialog = screen.getByRole('dialog');
            const mobaBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('MOBA'),
            );
            fireEvent.click(mobaBtn!);

            expect(screen.getByText(/Try selecting a different genre/i)).toBeInTheDocument();
        });
    });
});

// ============================================================
// ROK-375: Local source warning banner tests
// ============================================================
describe('GamesPage — ROK-375: local source warning banner', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDiscover();
    });

    it('shows "external search unavailable" warning when search source is "local"', () => {
        mockSearch(
            {
                data: [mockGame],
                meta: { total: 1, cached: true, source: 'local' },
            },
        );

        renderPage();
        const searchInput = screen.getByPlaceholderText('Search games...');
        fireEvent.change(searchInput, { target: { value: 'warcraft' } });

        expect(screen.getByText(/external search unavailable/i)).toBeInTheDocument();
    });

    it('does NOT show warning when search source is "igdb"', () => {
        mockSearch(
            {
                data: [mockGame],
                meta: { total: 1, cached: false, source: 'igdb' },
            },
        );

        renderPage();
        const searchInput = screen.getByPlaceholderText('Search games...');
        fireEvent.change(searchInput, { target: { value: 'warcraft' } });

        expect(screen.queryByText(/external search unavailable/i)).not.toBeInTheDocument();
    });

    it('does NOT show warning when search source is "database"', () => {
        mockSearch(
            {
                data: [mockGame],
                meta: { total: 1, cached: true, source: 'database' },
            },
        );

        renderPage();
        const searchInput = screen.getByPlaceholderText('Search games...');
        fireEvent.change(searchInput, { target: { value: 'warcraft' } });

        expect(screen.queryByText(/external search unavailable/i)).not.toBeInTheDocument();
    });

    it('does NOT show warning when search source is "redis"', () => {
        mockSearch(
            {
                data: [mockGame],
                meta: { total: 1, cached: true, source: 'redis' },
            },
        );

        renderPage();
        const searchInput = screen.getByPlaceholderText('Search games...');
        fireEvent.change(searchInput, { target: { value: 'warcraft' } });

        expect(screen.queryByText(/external search unavailable/i)).not.toBeInTheDocument();
    });

    it('does NOT show warning when not searching', () => {
        mockSearch(null);

        renderPage();

        expect(screen.queryByText(/external search unavailable/i)).not.toBeInTheDocument();
    });

});
