import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GamesPage } from './games-page';
import { GENRE_FILTERS } from './games/games-constants';
import * as useGamesDiscoverModule from '../hooks/use-games-discover';
import * as useGameSearchModule from '../hooks/use-game-search';

// Mock hooks
vi.mock('../hooks/use-games-discover');
vi.mock('../hooks/use-game-search');

vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({ user: null, isAuthenticated: false }),
    isOperatorOrAdmin: () => false,
    // ROK-1453: the LFG hooks call getAuthToken() to gate their jwt-only
    // reads, so a partial use-auth mock has to expose it too.
    getAuthToken: () => null,
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

// ROK-1402: the co-op filters are sessionStorage-backed, and jsdom keeps one
// storage across every test in the file — clear it so a filter set by one test
// can never leak into the next one's expectations.
beforeEach(() => {
    sessionStorage.clear();
});

// ============================================================
// ROK-1659: ONE Filters entry replaces the "Genre Filter" FAB + genre-only
// sheet and the desktop genre pills. Below 1024px the Filters FAB opens the
// whole panel in the BottomSheet; at 1024px and up the toolbar funnel opens it
// inline. Genres are checkboxes inside it; the badge counts ACTIVE filters.
// ============================================================

/** Open the Filters entry — the FAB below 1024px, the toolbar funnel at 1024px and up; both are named "Filters". */
function openFilters() {
    fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));
}

/** Phone/tablet viewport + default data, shared by the two FAB + sheet suites below. */
function setUpPhoneViewportSuite(): void {
    beforeEach(() => {
        vi.clearAllMocks();
        isDesktopViewport = false;
        mockDiscover();
        mockSearch();
    });

    afterEach(() => {
        isDesktopViewport = true;
    });
}

describe('GamesPage — ROK-1659: the Filters FAB + sheet (below 1024px) — opener and genre group', () => {
    setUpPhoneViewportSuite();

    it('renders exactly one Filters opener — the FAB — and neither the genre FAB nor the toolbar funnel', () => {
        renderPage();
        expect(screen.getAllByRole('button', { name: /^filters$/i })).toHaveLength(1);
        expect(screen.getByTestId('filter-fab')).toHaveAccessibleName('Filters');
        expect(screen.queryByTestId('filter-panel-trigger')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /genre filter/i })).not.toBeInTheDocument();
    });

    it('shows no count badge while no filter is active', () => {
        renderPage();
        expect(screen.getByTestId('filter-fab')).not.toHaveAttribute('aria-describedby');
        expect(screen.getByTestId('filter-fab')).toHaveTextContent(/^$/);
    });

    it('stays up while searching; the genre group turns off with its one-line hint instead', () => {
        renderPage();
        fireEvent.change(screen.getByPlaceholderText('Search games...'), { target: { value: 'wa' } });
        expect(screen.getByTestId('filter-fab')).toBeInTheDocument();

        openFilters();
        const sheet = screen.getByRole('dialog');
        expect(within(sheet).getByTestId('genre-filter-group')).toBeDisabled();
        expect(within(sheet).getByRole('checkbox', { name: 'RPG' })).toBeDisabled();
        expect(within(sheet).getByTestId('genre-search-hint')).toHaveTextContent(
            'Search results skip genres, so this group turns off while a search is active.',
        );
    });

    it('keeps the genre group live (and hint-free) while not searching', () => {
        renderPage();
        openFilters();
        const sheet = screen.getByRole('dialog');
        expect(within(sheet).getByTestId('genre-filter-group')).toBeEnabled();
        expect(within(sheet).queryByTestId('genre-search-hint')).not.toBeInTheDocument();
    });

});

describe('GamesPage — ROK-1659: the Filters FAB + sheet (below 1024px) — contents, badge and Clear all', () => {
    setUpPhoneViewportSuite();

    it('opens the whole set in the "Filters" sheet: LFG switch, players, owners and all 11 genres', () => {
        renderPage();
        openFilters();
        const sheet = screen.getByRole('dialog');
        expect(sheet.querySelector('h3')?.textContent).toBe('Filters');
        expect(within(sheet).getByRole('switch', { name: 'Players are looking' })).toHaveAttribute('aria-checked', 'false');
        expect(within(sheet).getByRole('radio', { name: 'Any' })).toBeChecked();
        expect(within(sheet).getByRole('checkbox', { name: 'Owned by 2+ members' })).not.toBeChecked();
        const genres = within(within(sheet).getByTestId('genre-filter-group'));
        expect(genres.getAllByRole('checkbox')).toHaveLength(GENRE_FILTERS.length);
        for (const genre of GENRE_FILTERS) {
            expect(genres.getByRole('checkbox', { name: genre.label })).not.toBeChecked();
        }
    });

    it('badges the FAB with the active-filter count: one per genre plus the players preset', () => {
        renderPage();
        openFilters();
        const sheet = screen.getByRole('dialog');
        fireEvent.click(within(sheet).getByRole('checkbox', { name: 'RPG' }));
        fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Shooter' }));
        fireEvent.click(within(sheet).getByRole('radio', { name: '4' }));

        expect(within(sheet).getByRole('checkbox', { name: 'RPG' })).toBeChecked();
        expect(screen.getByTestId('filter-fab')).toHaveTextContent('3');
        expect(screen.getByTestId('filter-fab')).toHaveAttribute('aria-describedby');
    });

    it('"Clear all" drops every filter and the badge with it', () => {
        renderPage();
        openFilters();
        const sheet = screen.getByRole('dialog');
        fireEvent.click(within(sheet).getByRole('checkbox', { name: 'RPG' }));
        fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Owned by 2+ members' }));
        expect(screen.getByTestId('filter-fab')).toHaveTextContent('2');

        fireEvent.click(within(sheet).getByRole('button', { name: 'Clear all' }));

        expect(within(sheet).getByRole('checkbox', { name: 'RPG' })).not.toBeChecked();
        expect(within(sheet).getByRole('checkbox', { name: 'Owned by 2+ members' })).not.toBeChecked();
        expect(screen.getByTestId('filter-fab')).toHaveTextContent(/^$/);
    });
});

describe('GamesPage — ROK-1659: the toolbar funnel + inline panel (1024px and up)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isDesktopViewport = true;
        mockDiscover();
        mockSearch();
    });

    it('puts the funnel in the toolbar and renders no FAB and no genre pill row', () => {
        renderPage();
        expect(screen.getByTestId('filter-panel-trigger')).toHaveAccessibleName('Filters');
        expect(screen.getByTestId('filter-panel-trigger')).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('filter-fab')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'RPG' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
    });

    it('filters the discover rows by the checked genre and badges the funnel', () => {
        renderPage();
        expect(screen.getAllByText('Top Shooters').length).toBeGreaterThan(0);

        openFilters();
        expect(screen.getByTestId('filter-panel-trigger')).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(screen.getByRole('checkbox', { name: 'RPG' }));

        expect(screen.getAllByText('Popular RPGs').length).toBeGreaterThan(0);
        expect(screen.queryByText('Top Shooters')).not.toBeInTheDocument();
        expect(screen.getByTestId('filter-panel-trigger')).toHaveTextContent('1');
    });

    it('shows the genre empty state when no game matches the checked genre', () => {
        vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
            data: { rows: [{ slug: 'row-1', category: 'Action', games: [{ ...mockGame, genres: [5] }] }] },
            isLoading: false,
            error: null,
        } as unknown as ReturnType<typeof useGamesDiscoverModule.useGamesDiscover>);
        renderPage();

        openFilters();
        fireEvent.click(screen.getByRole('checkbox', { name: 'MOBA' }));

        expect(screen.getByText(/Try selecting a different genre/i)).toBeInTheDocument();
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
//   • Online minimum       — the shared `Slider`, named by its visible label
//                            "Online co-op" (ROK-1650 ruling 12; the old
//                            aria-label "Min online players" is gone), "Any" at 0
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

/**
 * Set the "N+ online players" predicate. The control is a range slider
 * (operator review 2026-08-20 — matches the Common Ground sliders), so 0 is the
 * "Any" / inactive position rather than an empty string: a range input sanitizes
 * '' back to its midpoint, which would silently assert the wrong thing.
 */
function setOnlineMin(value: string) {
    fireEvent.change(onlineSlider(), { target: { value } });
}

/** The online-minimum Slider, named by its visible "Online co-op" label (ROK-1650 ruling 12). */
function onlineSlider(): HTMLElement {
    return screen.getByRole('slider', { name: 'Online co-op' });
}

/** The Slider's own `<output for>` readout (not a page-wide text match). */
function readoutOf(slider: HTMLElement): Element | undefined {
    return Array.from(document.querySelectorAll('output')).find((o) => o.getAttribute('for') === slider.id);
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

        expect(onlineSlider()).toBeInTheDocument();
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
        expect(within(sheet).getByRole('slider', { name: 'Online co-op' })).toBeInTheDocument();
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

    it('treats the slider at 0 ("Any") as inactive, not "N >= 0"', () => {
        renderPage();
        openCoopPanel();
        setOnlineMin('4');
        expect(rowCount('Solo Row')).toBe(0);

        setOnlineMin('0');

        expect(rowCount('Solo Row')).toBeGreaterThan(0);
        expect(screen.queryByTestId(COOP_HINT)).not.toBeInTheDocument();
    });
});

describe('GamesPage — ROK-1650: co-op controls are the shared Slider and Checkbox', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isDesktopViewport = true;
        mockCoopDiscover();
        mockSearch();
    });

    it('renders the online minimum as a Slider named "Online co-op" whose readout says "Any" at 0', () => {
        renderPage();
        openCoopPanel();

        const slider = onlineSlider();
        expect(slider).toHaveAttribute('type', 'range');
        // Ruling 12: the visible text is the name; the hidden aria-label is dropped.
        expect(screen.queryByLabelText(/min online players/i)).not.toBeInTheDocument();
        // The Slider's own readout: ROK-1659's Players group has an "Any"
        // segment and ROK-1525's player-count chips a bare "4", so a
        // page-wide getByText is ambiguous. aria-valuetext speaks the same.
        expect(readoutOf(slider)).toHaveTextContent(/^Any$/);
        expect(slider).toHaveAttribute('aria-valuetext', 'Any');

        setOnlineMin('4');
        expect(readoutOf(slider)).toHaveTextContent(/^4$/);
        expect(slider).toHaveAttribute('aria-valuetext', '4');
    });

    it('renders each co-op mode as a Checkbox whose visible label row is the 44px target', () => {
        renderPage();
        openCoopPanel();

        for (const name of ['Couch co-op', 'LAN co-op', 'Split-screen', 'Co-op campaign']) {
            const box = screen.getByRole('checkbox', { name });
            expect(box.closest('label')).toHaveClass('min-h-[44px]');
        }
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

    it('intersects the co-op predicate with the genre checkboxes in the same panel', () => {
        renderPage();
        openCoopPanel();
        setOnlineMin('4');

        // Check RPG (genre id 12) — ROK-1659 moved genres into the one panel.
        fireEvent.click(screen.getByRole('checkbox', { name: 'RPG' }));

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
        // Paired with an enriched row: under full dormancy a library with no
        // co-op data at all renders no controls, so the stale-shape safety this
        // test guards is only reachable once something else has been synced.
        const staleGame = { ...mockGame, id: 20, name: 'Stale Row Game', genres: [12] } as Record<string, unknown>;
        delete staleGame.playerCount;
        vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
            data: {
                rows: [
                    { slug: 'coop-row', category: 'Coop Row', games: [coopRpgGame] },
                    { slug: 'stale', category: 'Stale Row', games: [staleGame] },
                ],
            },
            isLoading: false,
            error: null,
        } as unknown as ReturnType<typeof useGamesDiscoverModule.useGamesDiscover>);

        renderPage();
        openCoopPanel();
        setOnlineMin('2');

        expect(screen.getByTestId(COOP_HINT)).toBeInTheDocument();
        expect(rowCount('Stale Row')).toBe(0);
        expect(rowCount('Coop Row')).toBeGreaterThan(0);
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

describe('GamesPage — ROK-1402: the whole section is dormant without co-op data', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isDesktopViewport = true;
        mockSearch();
    });

    it('renders no co-op group, no slider and no toggles when nothing has co-op data', () => {
        mockNoCoopDiscover();
        renderPage();

        // ROK-1659: the Filters entry itself always exists now (it holds LFG,
        // players, owners and genres), so dormancy is the co-op GROUP inside it.
        openCoopPanel();
        expect(screen.getByTestId('genre-filter-group')).toBeInTheDocument();
        expect(screen.queryByTestId('coop-filter-group')).not.toBeInTheDocument();
        expect(screen.queryByRole('slider', { name: 'Online co-op' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/couch co-op/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/lan co-op/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/split-screen/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/co-op campaign/i)).not.toBeInTheDocument();
    });

    it('activates the whole section once one loaded game is enriched', () => {
        mockCoopDiscover();
        renderPage();

        expect(screen.getByRole('button', { name: /^filters$/i })).toBeInTheDocument();
        openCoopPanel();
        expect(onlineSlider()).toBeInTheDocument();
        expect(screen.getByLabelText(/couch co-op/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/co-op campaign/i)).toBeInTheDocument();
    });

    it('ignores a stored filter when the library has no co-op data', () => {
        // The section is hidden, so a restored predicate would empty the grid
        // with no control on screen to undo it. It must go inert instead.
        sessionStorage.setItem('games-coop-filters', JSON.stringify({ onlineMinPlayers: 4 }));
        mockNoCoopDiscover();
        renderPage();

        expect(rowCount('Solo Row')).toBeGreaterThan(0);
        expect(screen.queryByTestId(COOP_HINT)).not.toBeInTheDocument();
        expect(screen.queryByTestId('coop-filter-group')).not.toBeInTheDocument();
        // The inert restored predicate must not count on the badge either.
        expect(screen.getByTestId('filter-panel-trigger')).toHaveTextContent(/^$/);
    });
});

// ============================================================
// ROK-1402 (operator review 2026-08-20): the co-op filters are sessionStorage-
// backed so opening a game's detail page and coming back does not silently drop
// them. `renderPage()` mounts a fresh tree, so unmount + re-render reproduces
// exactly what the router does on that round trip.
// ============================================================

describe('GamesPage — ROK-1402: co-op filters persist across remount', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isDesktopViewport = true;
        mockCoopDiscover();
        mockSearch();
    });

    it('restores the co-op predicate after an unmount/remount', () => {
        const { unmount } = renderPage();
        openCoopPanel();
        setOnlineMin('4');
        expect(rowCount('Solo Row')).toBe(0);

        unmount();
        renderPage();

        // Predicate is still applied and still disclosed, with no re-interaction.
        expect(rowCount('Solo Row')).toBe(0);
        expect(rowCount('Coop Row')).toBeGreaterThan(0);
        expect(screen.getByTestId(COOP_HINT)).toBeInTheDocument();
        openCoopPanel();
        expect(onlineSlider()).toHaveValue('4');
    });

    it('persists a mode toggle and clears the store on "Clear all"', () => {
        const { unmount } = renderPage();
        openCoopPanel();
        fireEvent.click(screen.getByRole('checkbox', { name: /split-screen/i }));
        expect(rowCount('Shooter Coop Row')).toBe(0);

        unmount();
        renderPage();
        expect(rowCount('Shooter Coop Row')).toBe(0);

        openCoopPanel();
        fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
        unmount();
        renderPage();

        expect(rowCount('Shooter Coop Row')).toBeGreaterThan(0);
        expect(screen.queryByTestId(COOP_HINT)).not.toBeInTheDocument();
    });

    it('ignores a corrupt or hand-edited sessionStorage entry', () => {
        sessionStorage.setItem('games-coop-filters', '{"onlineMinPlayers":"lots","bogus":true}');

        renderPage();

        expect(rowCount('Solo Row')).toBeGreaterThan(0);
        expect(screen.queryByTestId(COOP_HINT)).not.toBeInTheDocument();
    });
});
