/**
 * ROK-1453 AC5/AC6 — games-page LFG wiring.
 *
 * AC5 is a request-count assertion, not a rendering one: the tiles get their
 * LFG state from ONE `GET /lfg` per page mount no matter how many cards are on
 * screen (spec decision D1 — a provider around `DiscoverTab`, mirroring
 * `use-want-to-play-batch.tsx`, NOT a per-tile fetch).
 *
 * TDD: nothing on the page requests `/lfg` yet, so the counter stays at 0 and
 * the first test fails with "expected 0 to be 1" — a wrong-output failure, not
 * an import error (this file imports only existing modules on purpose, so it
 * keeps running once the components land).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../test/mocks/server';
import {
    countingLfgGroupsHandler,
    lfgGroupsHandler,
    lfgHeartedHandler,
} from '../test/mocks/lfg-handlers';
import {
    buildLfgGroupSummary,
    buildLfgHeartedGame,
} from '../test/factories/lfg';
import { ACCESS_TOKEN_KEY } from '../lib/api/auth-storage-keys';
import type { GameDetailDto } from '@raid-ledger/contract';
import { UnifiedGameCard } from '../components/games/unified-game-card';
import { GamesPage } from './games-page';
import * as useGamesDiscoverModule from '../hooks/use-games-discover';
import * as useGameSearchModule from '../hooks/use-game-search';

vi.mock('../hooks/use-games-discover');
vi.mock('../hooks/use-game-search');

vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({ user: null, isAuthenticated: false }),
    isOperatorOrAdmin: () => false,
    getAuthToken: () => 'test-token',
}));

vi.mock('../hooks/use-scroll-direction', () => ({
    useScrollDirection: () => 'up',
}));

// Only the carousel's own layout is stubbed — it renders the REAL
// `UnifiedGameCard` for every game, because a per-tile `GET /lfg/:id` can only
// be caught by the counter if the tiles that would issue it actually mount.
vi.mock('../components/games/GameCarousel', () => ({
    GameCarousel: ({ games }: { games: GameDetailDto[] }) => (
        <div data-testid="game-carousel">
            {games.map((g) => (
                <UnifiedGameCard key={g.id} variant="link" game={g} />
            ))}
        </div>
    ),
}));

vi.mock('../components/admin/GameLibraryTable', () => ({
    GameLibraryTable: () => <div data-testid="game-library-table" />,
}));

vi.mock('../components/games/games-mobile-toolbar', () => ({
    GamesMobileToolbar: () => <div data-testid="games-mobile-toolbar" />,
}));

vi.mock('../hooks/use-want-to-play-batch', () => ({
    WantToPlayProvider: ({ children }: { children: React.ReactNode }) => (
        <>{children}</>
    ),
}));

/** 30 tiles over three carousels — well past any per-tile fetch threshold. */
const TILE_COUNT = 30;

function buildGame(id: number) {
    return {
        id,
        igdbId: 1000 + id,
        name: `Discover Game ${id}`,
        slug: `discover-game-${id}`,
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
}

function buildDiscoverData() {
    const games = Array.from({ length: TILE_COUNT }, (_, i) => buildGame(i + 1));
    return {
        rows: [
            { slug: 'row-1', category: 'Popular', games: games.slice(0, 10) },
            { slug: 'row-2', category: 'Co-op', games: games.slice(10, 20) },
            { slug: 'row-3', category: 'New', games: games.slice(20) },
        ],
    };
}

function renderPage(route = '/games') {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[route]}>
                <GamesPage />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
    sessionStorage.clear();
    vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
        data: buildDiscoverData(),
        isLoading: false,
        error: null,
    } as never);
    vi.spyOn(useGameSearchModule, 'useGameSearch').mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
    } as never);
});

describe('GamesPage — LFG groups are fetched once (AC5)', () => {
    it('issues exactly one GET /lfg for a page full of tiles', async () => {
        const groups = Array.from({ length: 5 }, (_, i) =>
            buildLfgGroupSummary({
                gameId: i + 1,
                gameName: `Discover Game ${i + 1}`,
                gameSlug: `discover-game-${i + 1}`,
            }),
        );
        const { handler, calls } = countingLfgGroupsHandler(groups);
        // A per-tile read would hit `/lfg/:gameId`, which the list counter
        // above cannot see — count it separately so "batch, not N+1" is proven
        // against BOTH shapes the page could have used.
        const perGameCalls: string[] = [];
        server.use(
            handler,
            lfgHeartedHandler([]),
            http.get('http://localhost:3000/lfg/:gameId', ({ request }) => {
                perGameCalls.push(request.url);
                return HttpResponse.json([]);
            }),
        );

        renderPage();

        // The tiles are on screen — whatever LFG fetching happens, happens.
        expect(await screen.findAllByTestId('game-carousel')).toHaveLength(3);
        expect(
            screen.getAllByRole('link', { name: /Discover Game/ }),
        ).toHaveLength(TILE_COUNT);
        await waitFor(() => {
            expect(calls.length).toBeGreaterThan(0);
        });
        // One request for the whole page, not one per tile (D1).
        expect(calls).toHaveLength(1);
        expect(perGameCalls).toHaveLength(0);
    });
});

describe('GamesPage — cold-start prompt placement (AC6)', () => {
    it('renders the hearted prompt in the banner stack', async () => {
        server.use(
            countingLfgGroupsHandler([]).handler,
            lfgHeartedHandler([
                buildLfgHeartedGame({
                    gameId: 77,
                    gameName: 'Hearted Cold Start',
                    gameSlug: 'hearted-cold-start',
                }),
            ]),
        );

        renderPage();

        expect(
            await screen.findByTestId('lfg-hearted-prompt'),
        ).toBeInTheDocument();
        expect(screen.getByText('Hearted Cold Start')).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// AC3 — `?lfg=1` is a view of GET /lfg, not a filter over the Discover rows
// ---------------------------------------------------------------------------

describe('GamesPage — the ?lfg=1 view (AC3)', () => {
    it('lists every game GET /lfg reports, including ones no carousel carries', async () => {
        // Operator walk: the env had three live groups, two of which appear in
        // no Discover row, and the filtered view showed only the one that did —
        // so the banner promised "3 games have players looking" and the page
        // delivered one. The view is built from the LFG rows themselves.
        const inDiscover = buildLfgGroupSummary({
            gameId: 1,
            gameName: 'Discover Game 1',
            gameSlug: 'discover-game-1',
        });
        const offDiscover = [101, 102].map((id) =>
            buildLfgGroupSummary({
                gameId: id,
                gameName: `Off-Discover Game ${id}`,
                gameSlug: `off-discover-game-${id}`,
            }),
        );
        server.use(
            lfgGroupsHandler([inDiscover, ...offDiscover]),
            lfgHeartedHandler([]),
        );

        renderPage('/games?lfg=1');

        expect(
            await screen.findByText('Off-Discover Game 101'),
        ).toBeInTheDocument();
        expect(screen.getByText('Off-Discover Game 102')).toBeInTheDocument();
        expect(screen.getByText('Discover Game 1')).toBeInTheDocument();
        // One tile per row GET /lfg returned — the banner's count and the grid
        // agree by construction.
        expect(
            screen.getAllByTestId('lfg-looking-tile'),
        ).toHaveLength(3);
    });

    it('says so when nobody is looking, instead of an empty grid', async () => {
        server.use(lfgGroupsHandler([]), lfgHeartedHandler([]));

        renderPage('/games?lfg=1');

        expect(
            await screen.findByText(/nobody is looking right now/i),
        ).toBeInTheDocument();
        expect(screen.queryAllByTestId('lfg-looking-tile')).toHaveLength(0);
    });
});
