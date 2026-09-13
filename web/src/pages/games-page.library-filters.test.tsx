/**
 * ROK-1525 — the two defects the browser gate reproduced by hand
 * (`planning-artifacts/e2e-rok-1525/FINDINGS.md`, B1 + B2).
 *
 * B1: `?lfg=1` swaps the page to `LfgLookingGrid`, whose rows are LFG group
 * summaries and carry neither `playerCount` nor `ownerCount`. The library chips
 * kept rendering — pressed, with the "showing only games with player-count
 * data" hint — over a grid they cannot touch. The gate saw `Players 4` amber
 * while the view said "Nobody is looking right now".
 *
 * B2: the empty state only ever looked at the genre selection, so a player or
 * owner predicate that emptied a fully populated library was reported as
 * "No games in the library yet" / "Games will appear here once synced from
 * IGDB" — a false statement AND a recovery action the user cannot take.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GamesPage } from './games-page';
import * as useGamesDiscoverModule from '../hooks/use-games-discover';
import * as useGameSearchModule from '../hooks/use-game-search';

vi.mock('../hooks/use-games-discover');
vi.mock('../hooks/use-game-search');

// A logged-out viewer: `GET /lfg` never runs, so the LFG view renders without
// any network at all — this file is about the chrome around it, not its rows.
vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({ user: null, isAuthenticated: false }),
    isOperatorOrAdmin: () => false,
    getAuthToken: () => null,
}));

vi.mock('../hooks/use-scroll-direction', () => ({
    useScrollDirection: () => 'up',
}));

vi.mock('../components/games/GameCarousel', () => ({
    GameCarousel: ({ games }: { games: { id: number; name: string }[] }) => (
        <div data-testid="game-carousel">{games.map((g) => g.name).join(',')}</div>
    ),
}));

vi.mock('../components/games/DrawerCard', () => ({
    DrawerCard: ({ game }: { game: { name: string } }) => <div>{game.name}</div>,
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

/** 1-4 players, owned by 1 member — inside `players=4`, outside `owners=10`. */
const PARTY_GAME = {
    id: 1,
    igdbId: 100,
    name: 'Overcooked',
    slug: 'overcooked',
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
    playerCount: { min: 1, max: 4 },
    ownerCount: 1,
    twitchGameId: null,
    crossplay: null,
};

const DISCOVER_DATA = {
    rows: [{ slug: 'row-1', category: 'Party', games: [PARTY_GAME] }],
};

/** Prints the live query string so a "Clear filters" press can be asserted. */
function UrlProbe(): JSX.Element {
    const { search } = useLocation();
    return <div data-testid="url-probe">{search}</div>;
}

function renderPage(route: string, data: typeof DISCOVER_DATA | null = DISCOVER_DATA) {
    vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
        data,
        isLoading: false,
        error: null,
    } as unknown as ReturnType<typeof useGamesDiscoverModule.useGamesDiscover>);
    vi.spyOn(useGameSearchModule, 'useGameSearch').mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
    } as unknown as ReturnType<typeof useGameSearchModule.useGameSearch>);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[route]}>
                <GamesPage />
                <UrlProbe />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
});

describe('GamesPage — B1: the library chips do not lie in the LFG view', () => {
    it('hides the whole chip row while lfg=1 is the active view', () => {
        renderPage('/games?lfg=1');

        expect(screen.queryByTestId('player-count-chip-4')).toBeNull();
        expect(screen.queryByTestId('owners-filter-chip')).toBeNull();
    });

    it('hides the row AND its hint even when players/owners are in the URL', () => {
        renderPage('/games?lfg=1&players=4&owners=2');

        expect(screen.queryByTestId('player-count-chip-4')).toBeNull();
        expect(screen.queryByTestId('owners-filter-chip')).toBeNull();
        expect(screen.queryByTestId('library-filter-hint')).toBeNull();
    });

    it('still renders the row on the normal Discover view', () => {
        renderPage('/games?players=4');

        expect(screen.getByTestId('player-count-chip-4')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('owners-filter-chip')).toBeInTheDocument();
    });
});

describe('GamesPage — B2: the empty state names the filter that emptied it', () => {
    it('says the filters matched nothing when a predicate empties a stocked library', () => {
        renderPage('/games?owners=10');

        expect(screen.getByTestId('library-filters-empty')).toBeInTheDocument();
        expect(screen.getByText('No games match these filters')).toBeInTheDocument();
        expect(screen.queryByText('No games in the library yet')).toBeNull();
    });

    it('offers a Clear filters action that drops players and owners', async () => {
        renderPage('/games?players=5plus&owners=10');

        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

        await waitFor(() => {
            expect(screen.getByTestId('game-carousel')).toBeInTheDocument();
        });
        const search = new URLSearchParams(screen.getByTestId('url-probe').textContent ?? '');
        expect(search.get('players')).toBeNull();
        expect(search.get('owners')).toBeNull();
    });

    it('keeps the genre copy when the genre row alone emptied the grid', () => {
        renderPage('/games?genres=moba');

        expect(screen.getByText('No games match this genre')).toBeInTheDocument();
        expect(screen.queryByTestId('library-filters-empty')).toBeNull();
    });

    it('keeps the "nothing synced yet" copy for a genuinely empty library', () => {
        renderPage('/games?owners=10', { rows: [] });

        expect(screen.getByText('No games in the library yet')).toBeInTheDocument();
        expect(screen.queryByTestId('library-filters-empty')).toBeNull();
    });
});
