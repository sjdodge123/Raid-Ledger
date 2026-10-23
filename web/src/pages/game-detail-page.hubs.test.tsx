/**
 * ROK-1883 AC13 — the game page's Hubs card is signed-in only: a signed-out
 * viewer gets no card and the page never asks `/hubs/by-game` for it. The
 * signed-in case proves the request counter is wired.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { createMockGameHubs } from '../test/handlers/community-hubs';
import { partialResult } from '../test/partial-result';
import { GameDetailPage } from './game-detail-page';
import * as useGamesDiscoverModule from '../hooks/use-games-discover';
import * as useAuthHook from '../hooks/use-auth';
import * as useWantToPlayModule from '../hooks/use-want-to-play';

vi.mock('../lib/config', () => ({ API_BASE_URL: 'http://localhost:3000' }));
vi.mock('../components/games/ScreenshotGallery', () => ({ ScreenshotGallery: () => null }));
vi.mock('../components/games/TwitchStreamEmbed', () => ({ TwitchStreamEmbed: () => null }));
vi.mock('../components/events/event-card', () => ({ EventCard: () => null }));
vi.mock('../hooks/use-games-discover', () => ({
    useGameDetail: vi.fn(),
    useGameStreams: vi.fn(() => ({ data: null })),
    useGameActivity: vi.fn(() => ({ data: null, isLoading: false })),
    useGameNowPlaying: vi.fn(() => ({ data: null })),
    useGamePricing: vi.fn(() => ({ data: null, isLoading: false })),
}));
vi.mock('../hooks/use-events', () => ({ useEvents: vi.fn(() => ({ data: null })) }));
vi.mock('../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../hooks/use-auth')>()),
    useAuth: vi.fn(), getAuthToken: () => null, useViewerCacheScope: () => 'anon',
}));
vi.mock('../hooks/use-want-to-play', () => ({ useWantToPlay: vi.fn() }));

const GAME = {
    id: 42, igdbId: 1234, name: 'Valheim', slug: 'valheim', coverUrl: null, genres: [], summary: null,
    rating: null, aggregatedRating: null, popularity: null, gameModes: [], themes: [], platforms: [],
    screenshots: [], videos: [], firstReleaseDate: null, playerCount: null, twitchGameId: null, crossplay: null,
};

let byGameHits = 0;

function signIn(isAuthenticated: boolean): void {
    vi.mocked(useAuthHook.useAuth).mockReturnValue(partialResult<ReturnType<typeof useAuthHook.useAuth>>({
        user: isAuthenticated ? partialResult<NonNullable<ReturnType<typeof useAuthHook.useAuth>['user']>>({ id: 1, username: 'Tester', role: 'member' }) : null,
        isAuthenticated,
    }));
}

function renderPage(): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/games/42']}>
                <Routes><Route path="/games/:id" element={<GameDetailPage />} /></Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    byGameHits = 0;
    server.use(http.get('http://localhost:3000/hubs/by-game/:gameId', () => {
        byGameHits += 1;
        return HttpResponse.json(createMockGameHubs());
    }));
    vi.mocked(useGamesDiscoverModule.useGameDetail).mockReturnValue(partialResult<ReturnType<typeof useGamesDiscoverModule.useGameDetail>>({
        data: GAME, isLoading: false, error: null,
    }));
    vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue(partialResult<ReturnType<typeof useWantToPlayModule.useWantToPlay>>({
        wantToPlay: false, count: 0, players: [], owners: [], ownerCount: 0, isLoading: false, toggle: vi.fn(), isToggling: false,
    }));
});

afterEach(() => server.resetHandlers());

describe('GameDetailPage — Hubs card auth gate (ROK-1883 AC13)', () => {
    it('signed-out: no Hubs card, no skeleton and no by-game request', async () => {
        signIn(false);
        renderPage();
        expect(await screen.findByRole('heading', { name: 'Valheim' })).toBeInTheDocument();
        expect(screen.queryByTestId('game-hubs-loading')).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Hubs' })).toBeNull();
        expect(byGameHits).toBe(0);
    });

    it('signed-in: the same page does request by-game (the counter is live)', async () => {
        signIn(true);
        renderPage();
        await waitFor(() => expect(byGameHits).toBeGreaterThan(0));
        expect(await screen.findByRole('heading', { name: 'Hubs' })).toBeInTheDocument();
    });
});
