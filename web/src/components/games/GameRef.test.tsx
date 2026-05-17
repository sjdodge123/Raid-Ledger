/**
 * ROK-1295 — Vitest unit spec for <GameRef />.
 *
 * <GameRef /> is the trigger surface for <GameResearchDrawer />. Variants:
 *   - row    : thumb + name + sub line (wireframe)
 *   - inline : text + ⓘ affordance
 *   - thumb  : cover tile
 *
 * Behaviours under test:
 *   - row variant renders thumb, name, sub line
 *   - clicking the row body opens the drawer
 *   - clicking the optional inline action button does NOT open the drawer
 *   - ⓘ hover affordance is present on the row
 *   - `gameId` path uses useGameDetail (no name lookup)
 *   - `name`-only path triggers POST /games/lookup-by-name via the lookup hook
 *
 * Tests MUST fail until ROK-1295 ships the implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { GameDetailDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
// IMPORTANT: fails-by-construction until ROK-1295 lands.
import { GameRef } from './GameRef';

// ─── Hook mocks ──────────────────────────────────────────────────────────────

const mockUseGameDetail = vi.fn();
const mockUseGameLookupByName = vi.fn();

vi.mock('../../hooks/use-games-discover', () => ({
    useGameDetail: (id: number | undefined) => mockUseGameDetail(id),
    useGamePricing: () => ({ data: null, isLoading: false }),
}));

vi.mock('../../hooks/use-want-to-play', () => ({
    useWantToPlay: () => ({ wantToPlay: false, count: 0, toggle: vi.fn(), isToggling: false }),
}));

vi.mock('../../hooks/use-game-lookup-by-name', () => ({
    useGameLookupByName: (name: string | undefined, enabled: boolean) => mockUseGameLookupByName(name, enabled),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeGame(overrides: Partial<GameDetailDto> = {}): GameDetailDto {
    return {
        id: 42,
        igdbId: 4200,
        name: 'Valheim',
        slug: 'valheim',
        coverUrl: 'https://example.com/valheim-cover.jpg',
        genres: [],
        summary: 'A Norse-mythology survival game.',
        rating: null,
        aggregatedRating: null,
        popularity: null,
        gameModes: [],
        themes: [],
        platforms: [],
        screenshots: [],
        videos: [],
        firstReleaseDate: null,
        playerCount: { min: 1, max: 10 },
        twitchGameId: null,
        crossplay: null,
        itadGameId: null,
        itadBoxartUrl: null,
        ...overrides,
    };
}

function createClient(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

function renderRef(children: React.ReactElement) {
    return render(
        <QueryClientProvider client={createClient()}>
            <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>,
    );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GameRef — row variant', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseGameDetail.mockReturnValue({ data: makeGame(), isLoading: false, isError: false });
        mockUseGameLookupByName.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    });

    it('renders the thumb, name, and sub line', () => {
        renderRef(<GameRef variant="row" gameId={42} name="Valheim" sub="18 own · 1-10 players · -50% $9.99" />);
        expect(screen.getByText('Valheim')).toBeInTheDocument();
        expect(screen.getByText(/18 own/)).toBeInTheDocument();
        expect(screen.getByTestId('game-ref-row')).toBeInTheDocument();
    });

    it('shows an ⓘ info affordance', () => {
        renderRef(<GameRef variant="row" gameId={42} name="Valheim" />);
        const row = screen.getByTestId('game-ref-row');
        // The affordance is either a visible ⓘ glyph or a [data-info] marker.
        expect(row.querySelector('[data-testid="game-ref-info-affordance"]')).not.toBeNull();
    });

    it('clicking the row body opens the drawer', async () => {
        renderRef(<GameRef variant="row" gameId={42} name="Valheim" />);
        fireEvent.click(screen.getByTestId('game-ref-row'));
        await waitFor(() => {
            expect(screen.getByTestId('game-research-drawer')).toBeInTheDocument();
        });
    });

    it('clicking the inline action button does NOT open the drawer', () => {
        const onAction = vi.fn();
        renderRef(
            <GameRef
                variant="row"
                gameId={42}
                name="Valheim"
                action={{ label: '+ Nominate', onClick: onAction }}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: '+ Nominate' }));
        expect(onAction).toHaveBeenCalledOnce();
        expect(screen.queryByTestId('game-research-drawer')).not.toBeInTheDocument();
    });
});

describe('GameRef — gameId path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseGameDetail.mockReturnValue({ data: makeGame(), isLoading: false, isError: false });
        mockUseGameLookupByName.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    });

    it('uses useGameDetail when a gameId is supplied (no name lookup)', () => {
        renderRef(<GameRef variant="row" gameId={42} name="Valheim" />);
        fireEvent.click(screen.getByTestId('game-ref-row'));
        // useGameDetail is called with the numeric id.
        expect(mockUseGameDetail).toHaveBeenCalledWith(42);
        // useGameLookupByName is disabled / not used when gameId is known.
        const callsWithEnabledTrue = mockUseGameLookupByName.mock.calls.filter(
            ([, enabled]) => enabled === true,
        );
        expect(callsWithEnabledTrue.length).toBe(0);
    });
});

describe('GameRef — name-only path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseGameDetail.mockReturnValue({ data: undefined, isLoading: false, isError: false });
        mockUseGameLookupByName.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    });

    it('triggers POST /games/lookup-by-name when only a name is supplied', async () => {
        const lookupHits: { q: string }[] = [];
        server.use(
            http.post('http://localhost:3000/games/lookup-by-name', async ({ request }) => {
                const body = (await request.json()) as { q: string };
                lookupHits.push(body);
                return HttpResponse.json(makeGame({ name: 'Helldivers 2', slug: 'helldivers-2', id: 99 }));
            }),
        );

        renderRef(<GameRef variant="row" name="Helldivers 2" />);
        fireEvent.click(screen.getByTestId('game-ref-row'));

        // The name-lookup hook MUST be invoked with enabled=true once the drawer opens.
        await waitFor(() => {
            const enabledCalls = mockUseGameLookupByName.mock.calls.filter(
                ([n, enabled]) => n === 'Helldivers 2' && enabled === true,
            );
            expect(enabledCalls.length).toBeGreaterThan(0);
        });
    });
});
