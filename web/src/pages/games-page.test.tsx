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
        it('renders genre filter button with md:hidden class (mobile only)', () => {
            renderPage();
            const filterBtn = screen.getByRole('button', { name: /genre filter/i });
            expect(filterBtn).toBeInTheDocument();
            // The wrapping div should have md:hidden to hide on desktop
            const wrapper = filterBtn.closest('.md\\:hidden');
            expect(wrapper).toBeInTheDocument();
        });

        it('renders Genre Filter label text on the button', () => {
            renderPage();
            expect(screen.getByRole('button', { name: /genre filter/i })).toBeInTheDocument();
        });

        it('renders funnel icon inside the filter button', () => {
            const { container } = renderPage();
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
        it('renders desktop pills container with hidden md:flex classes', () => {
            const { container } = renderPage();
            const pillsContainer = container.querySelector('.hidden.md\\:flex');
            expect(pillsContainer).toBeInTheDocument();
        });

        it('renders "All" pill on desktop', () => {
            const { container } = renderPage();
            const pillsContainer = container.querySelector('.hidden.md\\:flex');
            expect(pillsContainer).not.toBeNull();
            const allButton = Array.from(pillsContainer!.querySelectorAll('button')).find(
                (btn) => btn.textContent?.trim() === 'All',
            );
            expect(allButton).toBeInTheDocument();
        });

        it('renders all 10 genre pills on desktop', () => {
            const { container } = renderPage();
            const pillsContainer = container.querySelector('.hidden.md\\:flex');
            expect(pillsContainer).not.toBeNull();
            // 1 "All" button + 10 genre buttons
            const buttons = pillsContainer!.querySelectorAll('button');
            expect(buttons.length).toBe(11);
        });
    });

    describe('Bottom Sheet behavior', () => {
        it('opens bottom sheet when filter button is clicked', () => {
            renderPage();
            const filterBtn = screen.getByRole('button', { name: /genre filter/i });
            fireEvent.click(filterBtn);

            // Bottom sheet should now be visible (translate-y-0)
            const dialog = screen.getByRole('dialog');
            expect(dialog).toHaveClass('translate-y-0');
        });

        it('bottom sheet has title "Genre Filter"', () => {
            renderPage();
            const filterBtn = screen.getByRole('button', { name: /genre filter/i });
            fireEvent.click(filterBtn);

            // The bottom sheet title renders as an h3 element
            const dialog = screen.getByRole('dialog');
            const title = dialog.querySelector('h3');
            expect(title?.textContent).toBe('Genre Filter');
        });

        it('bottom sheet is not visible initially', () => {
            renderPage();
            const dialog = screen.getByRole('dialog');
            expect(dialog).toHaveClass('translate-y-full');
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

        it('renders all 10 genre rows in bottom sheet', () => {
            const genreLabels = ['RPG', 'Shooter', 'Adventure', 'Strategy', 'Simulator', 'Sport', 'Racing', 'Fighting', 'Indie', 'MOBA'];

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

        it('closes bottom sheet when backdrop is clicked', () => {
            renderPage();
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));

            const dialog = screen.getByRole('dialog');
            expect(dialog).toHaveClass('translate-y-0');

            const backdrop = dialog.parentElement?.querySelector('[aria-hidden="true"]');
            if (backdrop) {
                fireEvent.click(backdrop as HTMLElement);
            }

            expect(dialog).toHaveClass('translate-y-full');
        });
    });

    describe('Genre selection', () => {
        it('selects a genre and closes sheet when genre row is tapped', () => {
            renderPage();
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));

            const dialog = screen.getByRole('dialog');
            const rpgBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('RPG'),
            );
            expect(rpgBtn).toBeDefined();
            fireEvent.click(rpgBtn!);

            // Sheet should close after selection
            expect(dialog).toHaveClass('translate-y-full');
        });

        it('selected genre row shows emerald background styling', () => {
            renderPage();
            // Open bottom sheet and click RPG
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            const dialog = screen.getByRole('dialog');
            const rpgBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('RPG'),
            );
            fireEvent.click(rpgBtn!);

            // Reopen bottom sheet
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            const dialogAfter = screen.getByRole('dialog');
            const rpgBtnAfter = Array.from(dialogAfter.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('RPG'),
            );
            expect(rpgBtnAfter).toHaveClass('bg-emerald-600/10');
        });

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

        it('tapping the same genre again deselects it', () => {
            renderPage();

            // Select RPG
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            let dialog = screen.getByRole('dialog');
            const rpgBtn1 = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('RPG'),
            );
            fireEvent.click(rpgBtn1!);

            // Badge should show
            expect(
                screen.getByRole('button', { name: /genre filter/i }).querySelector('span.rounded-full'),
            ).toBeInTheDocument();

            // Deselect RPG
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            dialog = screen.getByRole('dialog');
            const rpgBtn2 = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('RPG'),
            );
            fireEvent.click(rpgBtn2!);

            // Badge should be gone
            expect(
                screen.getByRole('button', { name: /genre filter/i }).querySelector('span.rounded-full'),
            ).not.toBeInTheDocument();
        });

        it('"All" option clears the selected genre', () => {
            renderPage();

            // Select RPG
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            let dialog = screen.getByRole('dialog');
            const rpgBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('RPG'),
            );
            fireEvent.click(rpgBtn!);

            // Badge should show
            expect(
                screen.getByRole('button', { name: /genre filter/i }).querySelector('span.rounded-full'),
            ).toBeInTheDocument();

            // Open sheet and tap "All"
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            dialog = screen.getByRole('dialog');
            const allBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('All'),
            );
            fireEvent.click(allBtn!);

            // Badge should be gone
            expect(
                screen.getByRole('button', { name: /genre filter/i }).querySelector('span.rounded-full'),
            ).not.toBeInTheDocument();
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

        it('"All" button closes bottom sheet on click', () => {
            renderPage();
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));

            const dialog = screen.getByRole('dialog');
            const allBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('All'),
            );
            fireEvent.click(allBtn!);

            expect(dialog).toHaveClass('translate-y-full');
        });
    });

    describe('Badge visibility', () => {
        it('shows badge with "1" when a genre is selected', () => {
            renderPage();
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            const dialog = screen.getByRole('dialog');
            const rpgBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('RPG'),
            );
            fireEvent.click(rpgBtn!);

            const filterBtn = screen.getByRole('button', { name: /genre filter/i });
            const badge = filterBtn.querySelector('span.rounded-full');
            expect(badge).toBeInTheDocument();
            expect(badge?.textContent).toBe('1');
        });

        it('badge has emerald background styling', () => {
            renderPage();
            fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
            const dialog = screen.getByRole('dialog');
            const rpgBtn = Array.from(dialog.querySelectorAll('button')).find(
                (b) => b.textContent?.includes('RPG'),
            );
            fireEvent.click(rpgBtn!);

            const filterBtn = screen.getByRole('button', { name: /genre filter/i });
            const badge = filterBtn.querySelector('span.rounded-full');
            expect(badge).toHaveClass('bg-emerald-600');
        });

        it('no badge when no genre selected', () => {
            renderPage();
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
