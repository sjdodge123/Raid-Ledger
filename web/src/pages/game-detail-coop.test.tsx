/**
 * Wiring tests for the Co-Optimus co-op section on the game detail page (ROK-1398).
 *
 * TDD — written BEFORE the section is wired into `game-detail-page.tsx`. These
 * tests guard the *placement* half of AC1/AC2: it is not enough for
 * CoopFeaturesSection to exist, the page has to render it (between the banner
 * and the Community Activity section).
 *
 * The Co-Optimus HTTP user-agent is deliberately never referenced here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GameDetailPage } from './game-detail-page';
import * as useGamesDiscoverHook from '../hooks/use-games-discover';
import * as useEventsHook from '../hooks/use-events';
import * as useWantToPlayHook from '../hooks/use-want-to-play';

vi.mock('../hooks/use-games-discover');
vi.mock('../hooks/use-events');
vi.mock('../hooks/use-want-to-play');
vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({ user: null, isLoading: false, isAuthenticated: false }),
}));

const SECTION = 'coop-features-section';
const CREDIT = /co-op data from co-optimus/i;
const COOPTIMUS_URL = 'https://www.co-optimus.com/game/4471/pc/example.html';

const baseGame = {
    id: 42,
    igdbId: 42,
    name: 'Deep Rock Galactic',
    slug: 'deep-rock-galactic',
    coverUrl: null,
    genres: [],
    themes: [],
    gameModes: [],
    platforms: [],
    summary: 'Dwarves mine things.',
    rating: null,
    aggregatedRating: null,
    popularity: null,
    screenshots: [],
    videos: [],
    firstReleaseDate: null,
    playerCount: null,
    twitchGameId: null,
    crossplay: null,
    cooptimusOnlineMax: null,
    cooptimusCouchMax: null,
    cooptimusLanMax: null,
    cooptimusSplitscreen: null,
    cooptimusDropIn: null,
    cooptimusCampaignCoop: null,
    cooptimusComboCoop: null,
    cooptimusUrl: null,
    cooptimusSyncedAt: null,
    cooptimusExtras: null,
};

const enrichedGame = {
    ...baseGame,
    cooptimusSyncedAt: '2026-08-18T00:00:00.000Z',
    cooptimusOnlineMax: 4,
    cooptimusCouchMax: 2,
    cooptimusLanMax: 4,
    cooptimusSplitscreen: true,
    cooptimusDropIn: true,
    cooptimusCampaignCoop: true,
    cooptimusComboCoop: true,
    cooptimusUrl: COOPTIMUS_URL,
    cooptimusExtras: { system: 'PC', downloadableOnly: true },
};

function setupMocks(game: typeof baseGame) {
    vi.spyOn(useGamesDiscoverHook, 'useGameDetail').mockReturnValue({
        data: game, isLoading: false, error: null,
    } as never);
    vi.spyOn(useGamesDiscoverHook, 'useGameStreams').mockReturnValue({
        data: null, isLoading: false, error: null,
    } as never);
    vi.spyOn(useGamesDiscoverHook, 'useGamePricing').mockReturnValue({
        data: null, isLoading: false, error: null,
    } as never);
    vi.spyOn(useGamesDiscoverHook, 'useGameActivity').mockReturnValue({
        data: undefined, isLoading: false, error: null,
    } as never);
    vi.spyOn(useGamesDiscoverHook, 'useGameNowPlaying').mockReturnValue({
        data: { players: [], count: 0 }, isLoading: false, error: null,
    } as never);
    vi.spyOn(useEventsHook, 'useEvents').mockReturnValue({
        data: null, isLoading: false, error: null,
    } as never);
    vi.spyOn(useWantToPlayHook, 'useWantToPlay').mockReturnValue({
        wantToPlay: false, count: 0, source: undefined, players: [],
        toggle: vi.fn(), isToggling: false,
    } as never);
}

function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={['/games/42']}>
                <Routes>
                    <Route path="/games/:id" element={<GameDetailPage />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('GameDetailPage — Co-Optimus co-op section wiring (ROK-1398)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders the co-op section for an enriched game', async () => {
        setupMocks(enrichedGame);
        renderPage();
        expect(await screen.findByTestId(SECTION)).toBeInTheDocument();
    });

    it('renders the Co-Optimus attribution credit on the page for an enriched game', async () => {
        setupMocks(enrichedGame);
        renderPage();
        expect(await screen.findByText(CREDIT)).toBeInTheDocument();
    });

    it('omits the co-op section entirely for a never-synced game', async () => {
        // Positive control first, so this test cannot pass vacuously while the
        // section does not exist at all.
        setupMocks(enrichedGame);
        const enriched = renderPage();
        expect(await screen.findByTestId(SECTION)).toBeInTheDocument();
        enriched.unmount();

        setupMocks(baseGame);
        renderPage();
        expect(screen.queryByTestId(SECTION)).not.toBeInTheDocument();
        expect(screen.queryByText(CREDIT)).not.toBeInTheDocument();
    });

    it('places the co-op section after the game title banner', async () => {
        setupMocks(enrichedGame);
        const { container } = renderPage();
        const section = await screen.findByTestId(SECTION);
        const heading = screen.getByRole('heading', { level: 1, name: /deep rock galactic/i });
        // Node.DOCUMENT_POSITION_FOLLOWING === 4 — the section comes after the h1.
        expect(heading.compareDocumentPosition(section) & 4).toBeTruthy();
        expect(container).toContainElement(section);
    });
});
