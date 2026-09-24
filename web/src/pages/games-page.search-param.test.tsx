/**
 * ROK-1615 — `/games?q=<term>` opens the page already searching.
 *
 * The hook's own rules are pinned in `games/use-search-query-param.test.ts`.
 * This file is the rendered half: it proves the page actually SWAPS views on a
 * hydrated term, that the `length >= 2` gate still decides (a one-character `q`
 * hydrates the box and leaves Discover on screen), that an inert term shows the
 * ordinary page rather than a blank grid, and that typing keeps the URL in step.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GamesPage } from './games-page';
import { MAX_SEARCH_QUERY_LENGTH } from './games/use-search-query-param';
import { resetLatestSearchParams } from './games/use-search-param-write';
import * as useGamesDiscoverModule from '../hooks/use-games-discover';
import * as useGameSearchModule from '../hooks/use-game-search';

vi.mock('../hooks/use-games-discover');
vi.mock('../hooks/use-game-search');

// A logged-out viewer: `GET /lfg` never runs, so the looking view renders with
// no network at all — this file is about which view is on screen, not its rows.
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

vi.mock('../components/games/unified-game-card', () => ({
    UnifiedGameCard: ({ game }: { game: { name: string } }) => (
        <div data-testid="search-result-card">{game.name}</div>
    ),
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

const LIBRARY_GAME = { id: 1, name: 'Overcooked', genres: [], playerCount: { min: 1, max: 4 }, ownerCount: 1 };
const SEARCH_HIT = { id: 42, name: 'Deep Rock Galactic', genres: [], playerCount: { min: 1, max: 4 }, ownerCount: 1 };

const DISCOVER_DATA = { rows: [{ slug: 'row-1', category: 'Party', games: [LIBRARY_GAME] }] };

/** Prints the live query string so a keystroke's URL write can be asserted. */
function UrlProbe(): JSX.Element {
    const { search } = useLocation();
    return <div data-testid="url-probe">{search}</div>;
}

function renderPage(route: string) {
    vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
        data: DISCOVER_DATA,
        isLoading: false,
        error: null,
    } as unknown as ReturnType<typeof useGamesDiscoverModule.useGamesDiscover>);
    vi.spyOn(useGameSearchModule, 'useGameSearch').mockReturnValue({
        data: { data: [SEARCH_HIT], meta: { source: 'igdb' } },
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

function searchBox(): HTMLInputElement {
    return screen.getByLabelText('Search games') as HTMLInputElement;
}

function liveParams(): URLSearchParams {
    return new URLSearchParams(screen.getByTestId('url-probe').textContent ?? '');
}

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    resetLatestSearchParams();
});

describe('GamesPage — ?q= hydrates the search box (AC1)', () => {
    it('opens already searching for a deep-linked term', () => {
        renderPage('/games?q=deep+rock');

        expect(searchBox().value).toBe('deep rock');
        // The results render twice — a desktop grid and a mobile one.
        expect(screen.getAllByTestId('search-result-card')[0]).toHaveTextContent('Deep Rock Galactic');
        expect(screen.queryByTestId('game-carousel')).toBeNull();
    });

    it('hydrates a one-character term without swapping away from Discover', () => {
        renderPage('/games?q=d');

        expect(searchBox().value).toBe('d');
        // The `length >= 2` gate still decides: Discover stays on screen rather
        // than a half-rendered "No games found" for a term nobody searched.
        expect(screen.getByTestId('game-carousel')).toBeInTheDocument();
        expect(screen.queryByTestId('search-result-card')).toBeNull();
    });

    it('leaves the page untouched with no q at all', () => {
        renderPage('/games');

        expect(searchBox().value).toBe('');
        expect(screen.getByTestId('game-carousel')).toBeInTheDocument();
    });
});

describe('GamesPage — an inert term shows the ordinary page (AC4)', () => {
    it('renders Discover, not a blank grid, for a term past the contract cap', () => {
        renderPage(`/games?q=${'a'.repeat(MAX_SEARCH_QUERY_LENGTH + 1)}`);

        expect(searchBox().value).toBe('');
        expect(screen.getByTestId('game-carousel')).toBeInTheDocument();
    });

    it('caps what the box will accept so typing cannot reach that state', () => {
        renderPage('/games');

        expect(searchBox()).toHaveAttribute('maxlength', String(MAX_SEARCH_QUERY_LENGTH));
    });
});

describe('GamesPage — lfg=1 and q are one view or the other (AC2)', () => {
    it('shows the looking view, with an empty box, for ?lfg=1&q=deep', () => {
        renderPage('/games?lfg=1&q=deep');

        expect(searchBox().value).toBe('');
        // Neither the search results nor Discover are on screen: `lfg=1` owns
        // the view, exactly as it would with no `q` in the URL at all.
        expect(screen.queryAllByTestId('search-result-card')).toHaveLength(0);
        expect(screen.queryByTestId('game-carousel')).toBeNull();
    });

    it('swaps to the search view when a term is typed over the looking view', async () => {
        renderPage('/games?lfg=1');

        fireEvent.change(searchBox(), { target: { value: 'deep' } });

        await waitFor(() => {
            expect(screen.queryAllByTestId('search-result-card').length).toBeGreaterThan(0);
        });
        expect(liveParams().get('lfg')).toBeNull();
        expect(liveParams().get('q')).toBe('deep');
    });
});

describe('GamesPage — "Clear all" drops the filter params and keeps q (ROK-1659)', () => {
    it('leaves q as the only param after clearing lfg, players, owners and genres', () => {
        renderPage('/games?q=wa&lfg=1&players=4&owners=2&genres=rpg');

        fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear all' }));

        expect([...liveParams().entries()]).toEqual([['q', 'wa']]);
    });
});

describe('GamesPage — typing keeps the URL in step (AC3/AC5)', () => {
    it('writes the typed term to q, alongside the other filters', async () => {
        renderPage('/games?players=4');

        fireEvent.change(searchBox(), { target: { value: 'deep' } });

        await waitFor(() => {
            expect(liveParams().get('q')).toBe('deep');
        });
        expect(liveParams().get('players')).toBe('4');
        expect(searchBox().value).toBe('deep');
    });

    it('drops q when the box is cleared', async () => {
        renderPage('/games?q=deep&players=4');

        fireEvent.click(screen.getByLabelText('Clear search'));

        await waitFor(() => {
            expect(screen.getByTestId('game-carousel')).toBeInTheDocument();
        });
        expect(liveParams().get('q')).toBeNull();
        expect(liveParams().get('players')).toBe('4');
        expect(searchBox().value).toBe('');
    });
});
