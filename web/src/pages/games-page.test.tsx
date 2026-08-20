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

// ROK-1402: FilterPanel renders inline on desktop and as a BottomSheet on
// mobile. jsdom's matchMedia stub answers `false` for every non-dark query, so
// drive the breakpoint explicitly instead. Default to desktop (inline panel).
let isDesktopViewport = true;
vi.mock('../hooks/use-media-query', () => ({
    useMediaQuery: () => isDesktopViewport,
}));

// Prevent rendering complex child components. Mock mirrors GameCarousel's
// badge behavior so page-level tests can assert badge wiring end-to-end.
vi.mock('../components/games/GameCarousel', () => ({
    GameCarousel: ({
        category,
        games,
        metadata,
    }: {
        category: string;
        games: { id: number; name: string }[];
        metadata?: Record<string, { playerCount: number; totalSeconds: number }>;
    }) => (
        <div
            data-testid="game-carousel"
            data-category={category}
            data-game-ids={games.map((g) => g.id).join(',')}
        >
            {category}
            {games.map((g) => {
                const count = metadata?.[String(g.id)]?.playerCount;
                return count !== undefined && count >= 1 ? (
                    <span key={g.id} data-testid="community-played-badge">
                        {`${new Intl.NumberFormat('en-US').format(count)} played`}
                    </span>
                ) : null;
            })}
        </div>
    ),
}));

vi.mock('../components/games/unified-game-card', () => ({
    UnifiedGameCard: ({ game }: { game: { name: string } }) => <div data-testid="game-card">{game.name}</div>,
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
    } as unknown as ReturnType<typeof useGamesDiscoverModule.useGamesDiscover>);
}

function mockSearch(data: Record<string, unknown> | null = null, isLoading = false) {
    vi.spyOn(useGameSearchModule, 'useGameSearch').mockReturnValue({
        data,
        isLoading,
        error: null,
    } as unknown as ReturnType<typeof useGameSearchModule.useGameSearch>);
}

describe('GamesPage — Genre Filter Bottom Sheet (ROK-337) — part 1', () => {
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

});

describe('GamesPage — Genre Filter Bottom Sheet (ROK-337) — part 2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDiscover();
        mockSearch();
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

});

describe('GamesPage — Genre Filter Bottom Sheet (ROK-337) — part 3', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDiscover();
        mockSearch();
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

});

describe('GamesPage — Genre Filter Bottom Sheet (ROK-337) — part 4', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDiscover();
        mockSearch();
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

});

describe('GamesPage — Genre Filter Bottom Sheet (ROK-337) — part 5', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDiscover();
        mockSearch();
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
            } as unknown as ReturnType<typeof useGamesDiscoverModule.useGamesDiscover>);

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

// ============================================================
// ROK-565: "Your Community Has Been Playing" discover row
// ============================================================
describe('GamesPage — ROK-565: community-playing discover row', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSearch();
    });

    it('renders the community-has-been-playing row first in discover', () => {
        vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
            data: {
                rows: [
                    {
                        slug: 'community-has-been-playing',
                        category: 'Your Community Has Been Playing',
                        games: [{ ...mockGame, id: 99, name: 'Community Game' }],
                        metadata: { '99': { playerCount: 12, totalSeconds: 3600 } },
                    },
                    { slug: 'row-2', category: 'Popular RPGs', games: [mockGame] },
                ],
            },
            isLoading: false,
            error: null,
        } as unknown as ReturnType<typeof useGamesDiscoverModule.useGamesDiscover>);

        renderPage();

        const carousels = screen.getAllByTestId('game-carousel');
        // Two render paths (desktop + mobile), each ordered the same.
        expect(carousels.length).toBeGreaterThanOrEqual(1);
        expect(carousels[0].getAttribute('data-category')).toBe('Your Community Has Been Playing');
    });

    it('shows "N played" badge for games with metadata', () => {
        vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
            data: {
                rows: [
                    {
                        slug: 'community-has-been-playing',
                        category: 'Your Community Has Been Playing',
                        games: [{ ...mockGame, id: 99, name: 'Community Game' }],
                        metadata: { '99': { playerCount: 12, totalSeconds: 3600 } },
                    },
                ],
            },
            isLoading: false,
            error: null,
        } as unknown as ReturnType<typeof useGamesDiscoverModule.useGamesDiscover>);

        renderPage();

        const badges = screen.getAllByTestId('community-played-badge');
        expect(badges.length).toBeGreaterThan(0);
        expect(badges[0]).toHaveTextContent('12 played');
    });

    it('renders rows without metadata without crashing (contract back-compat)', () => {
        mockDiscover();
        renderPage();

        expect(screen.getAllByText('Popular RPGs').length).toBeGreaterThan(0);
        expect(screen.queryByTestId('community-played-badge')).not.toBeInTheDocument();
    });
});

// ============================================================
// ROK-1402: co-op filters on the games library page (FilterPanel)
//
// TDD — written before the implementation. Prescribed surface:
//   • `FilterPanelTrigger` from `components/ui/filter-panel` (aria-label
//     "Filters" — distinct from the existing "Genre Filter" FAB) rendered on
//     the discover tab, wired to a `FilterPanel` whose children are the co-op
//     controls.
//   • Numeric input        — aria-label "Min online players"
//   • Toggles (checkboxes) — "Couch co-op", "LAN co-op", "Split-screen",
//                            "Co-op campaign"
//   • Hint line            — data-testid "coop-filter-hint", copy
//                            "Showing games with co-op data", rendered ONLY
//                            while at least one co-op predicate is active.
//
// The Co-Optimus HTTP user-agent is deliberately never referenced here.
// ============================================================

const COOP_HINT = 'coop-filter-hint';

/** Enriched: 4-player online + split-screen, RPG genre. */
const coopRpgGame = {
    ...mockGame,
    id: 10,
    name: 'Coop RPG',
    genres: [12],
    cooptimusOnlineMax: 4,
    cooptimusCouchMax: 2,
    cooptimusLanMax: 4,
    cooptimusSplitscreen: true,
    cooptimusCampaignCoop: true,
    cooptimusSyncedAt: '2026-08-20T00:00:00.000Z',
};

/** Never synced, no IGDB player count — excluded whenever a co-op filter is on. */
const noCoopDataGame = {
    ...mockGame,
    id: 11,
    name: 'No Coop Data',
    genres: [12],
};

/** Enriched but Shooter genre — used for the genre-pill composition test. */
const coopShooterGame = {
    ...mockGame,
    id: 12,
    name: 'Coop Shooter',
    genres: [5],
    cooptimusOnlineMax: 8,
    cooptimusSplitscreen: false,
    cooptimusSyncedAt: '2026-08-20T00:00:00.000Z',
};

function mockCoopDiscover() {
    vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
        data: {
            rows: [
                { slug: 'coop-row', category: 'Coop Row', games: [coopRpgGame] },
                { slug: 'solo-row', category: 'Solo Row', games: [noCoopDataGame] },
                { slug: 'shooter-row', category: 'Shooter Coop Row', games: [coopShooterGame] },
            ],
        },
        isLoading: false,
        error: null,
    } as unknown as ReturnType<typeof useGamesDiscoverModule.useGamesDiscover>);
}

/** Open the co-op FilterPanel via its trigger. */
function openCoopPanel() {
    fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));
}

/** Set the "N+ online players" numeric predicate. */
function setOnlineMin(value: string) {
    fireEvent.change(screen.getByLabelText(/min online players/i), {
        target: { value },
    });
}

/** How many times a discover row category appears across desktop + mobile paths. */
function rowCount(category: string): number {
    return screen.queryAllByText(category).length;
}

describe('GamesPage — ROK-1402: co-op FilterPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isDesktopViewport = true;
        mockCoopDiscover();
        mockSearch();
    });

    it('renders the co-op filter trigger on the discover tab', () => {
        renderPage();
        expect(screen.getByRole('button', { name: /^filters$/i })).toBeInTheDocument();
    });

    it('exposes the numeric input and all four boolean toggles when opened', () => {
        renderPage();
        openCoopPanel();

        expect(screen.getByLabelText(/min online players/i)).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: /couch co-op/i })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: /lan co-op/i })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: /split-screen/i })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: /co-op campaign/i })).toBeInTheDocument();
    });

    it('does not render the co-op hint until a predicate is active', () => {
        renderPage();
        openCoopPanel();
        expect(screen.queryByTestId(COOP_HINT)).not.toBeInTheDocument();
    });

    it('renders the "showing games with co-op data" hint while a predicate is active', () => {
        renderPage();
        openCoopPanel();
        setOnlineMin('4');

        const hint = screen.getByTestId(COOP_HINT);
        expect(hint).toBeInTheDocument();
        expect(hint).toHaveTextContent(/showing games with co-op data/i);
    });

    it('renders the panel as a BottomSheet on mobile viewports', () => {
        isDesktopViewport = false;
        renderPage();
        openCoopPanel();

        const sheet = screen.getByRole('dialog');
        expect(sheet.querySelector('h3')?.textContent).toBe('Filters');
        expect(screen.getByLabelText(/min online players/i)).toBeInTheDocument();
    });

    it('excludes rows whose games have no co-op data when the numeric predicate is active', () => {
        renderPage();
        expect(rowCount('Solo Row')).toBeGreaterThan(0);

        openCoopPanel();
        setOnlineMin('4');

        expect(rowCount('Coop Row')).toBeGreaterThan(0);
        expect(rowCount('Shooter Coop Row')).toBeGreaterThan(0);
        expect(rowCount('Solo Row')).toBe(0);
    });

    it('treats a cleared numeric input as inactive (not "N >= 0")', () => {
        renderPage();
        openCoopPanel();
        setOnlineMin('4');
        expect(rowCount('Solo Row')).toBe(0);

        setOnlineMin('');

        expect(rowCount('Solo Row')).toBeGreaterThan(0);
        expect(screen.queryByTestId(COOP_HINT)).not.toBeInTheDocument();
    });

});

describe('GamesPage — ROK-1402: co-op FilterPanel — part 2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isDesktopViewport = true;
        mockCoopDiscover();
        mockSearch();
    });

    it('applies a boolean toggle: split-screen keeps only flag === true rows', () => {
        renderPage();
        openCoopPanel();
        fireEvent.click(screen.getByRole('checkbox', { name: /split-screen/i }));

        expect(rowCount('Coop Row')).toBeGreaterThan(0);
        expect(rowCount('Shooter Coop Row')).toBe(0);
        expect(rowCount('Solo Row')).toBe(0);
        expect(screen.getByTestId(COOP_HINT)).toBeInTheDocument();
    });

    it('intersects the co-op predicate with the genre pills', () => {
        renderPage();
        openCoopPanel();
        setOnlineMin('4');

        // Select RPG (genre id 12) from the mobile genre sheet.
        fireEvent.click(screen.getByRole('button', { name: /genre filter/i }));
        const dialog = screen.getByRole('dialog');
        const rpgBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
            b.textContent?.includes('RPG'),
        );
        fireEvent.click(rpgBtn!);

        expect(rowCount('Coop Row')).toBeGreaterThan(0);
        expect(rowCount('Shooter Coop Row')).toBe(0);
        expect(rowCount('Solo Row')).toBe(0);
    });

    it('"Clear all" resets the co-op predicates and hides the hint', () => {
        renderPage();
        openCoopPanel();
        setOnlineMin('4');
        expect(rowCount('Solo Row')).toBe(0);

        fireEvent.click(screen.getByRole('button', { name: /clear all/i }));

        expect(rowCount('Solo Row')).toBeGreaterThan(0);
        expect(screen.queryByTestId(COOP_HINT)).not.toBeInTheDocument();
    });

    it('does not crash on stale rows whose co-op fields are absent', () => {
        const staleGame = { ...mockGame, id: 20, name: 'Stale Row Game', genres: [12] } as Record<string, unknown>;
        delete staleGame.playerCount;
        vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
            data: { rows: [{ slug: 'stale', category: 'Stale Row', games: [staleGame] }] },
            isLoading: false,
            error: null,
        } as unknown as ReturnType<typeof useGamesDiscoverModule.useGamesDiscover>);

        renderPage();
        openCoopPanel();
        setOnlineMin('2');

        expect(screen.getByTestId(COOP_HINT)).toBeInTheDocument();
        expect(rowCount('Stale Row')).toBe(0);
    });
});

describe('GamesPage — ROK-1402: co-op filters compose with search', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isDesktopViewport = true;
        mockCoopDiscover();
        mockSearch({
            data: [coopRpgGame, noCoopDataGame],
            meta: { total: 2, cached: false, source: 'igdb' },
        });
    });

    it('intersects the co-op predicate with an active search query', () => {
        renderPage();
        // Set the predicate first — the trigger is only rendered outside search
        // if the dev gates it, so open + set before typing the query.
        openCoopPanel();
        setOnlineMin('4');

        fireEvent.change(screen.getByPlaceholderText('Search games...'), {
            target: { value: 'coop' },
        });

        const cards = screen.getAllByTestId('game-card').map((c) => c.textContent);
        expect(cards).toContain('Coop RPG');
        expect(cards).not.toContain('No Coop Data');
    });

    it('keeps the co-op hint visible while searching with an active predicate', () => {
        renderPage();
        openCoopPanel();
        setOnlineMin('4');

        fireEvent.change(screen.getByPlaceholderText('Search games...'), {
            target: { value: 'coop' },
        });

        expect(screen.getByTestId(COOP_HINT)).toBeInTheDocument();
    });
});


// ============================================================
// Operator decision 2026-08-20: the four Co-Optimus-only mode toggles stay
// hidden until enrichment data exists (they'd only empty the grid); the
// numeric input keeps its IGDB fallback and is always visible.
// ============================================================

function mockNoCoopDiscover() {
    vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
        data: {
            rows: [{ slug: 'solo-row', category: 'Solo Row', games: [noCoopDataGame] }],
        },
        isLoading: false,
        error: null,
    } as unknown as ReturnType<typeof useGamesDiscoverModule.useGamesDiscover>);
}

describe('GamesPage — ROK-1402: mode toggles gated on data presence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isDesktopViewport = true;
        mockSearch();
    });

    it('hides the four mode toggles when no loaded game has Co-Optimus data', () => {
        mockNoCoopDiscover();
        renderPage();
        openCoopPanel();
        expect(screen.getByLabelText(/min online players/i)).toBeInTheDocument();
        expect(screen.queryByLabelText(/couch co-op/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/lan co-op/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/split-screen/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/co-op campaign/i)).not.toBeInTheDocument();
    });

    it('shows the mode toggles when at least one loaded game is enriched', () => {
        mockCoopDiscover();
        renderPage();
        openCoopPanel();
        expect(screen.getByLabelText(/couch co-op/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/co-op campaign/i)).toBeInTheDocument();
    });
});
