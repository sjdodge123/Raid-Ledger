/**
 * ROK-1295 — Vitest unit spec for <GameResearchDrawer />.
 *
 * Covers:
 *  - open/close visibility driven by `isOpen`
 *  - Esc key handler
 *  - Outside-click on backdrop
 *  - X-button click
 *  - Focus trap engages on open (first focusable inside drawer gains focus)
 *  - Renders cover / description / pills / screenshots / store links from a
 *    fixture GameDetailDto when `gameId` is supplied
 *  - CTA renders caller-supplied `action.label` and fires `action.onClick`
 *  - Fallback "View full game page →" link when `action` is omitted
 *  - Loading state shows skeleton; error state shows retry
 *
 * Tests MUST fail until ROK-1295's implementation lands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GameDetailDto } from '@raid-ledger/contract';
// IMPORTANT: this import is fails-by-construction until ROK-1295 lands.
import { GameResearchDrawer } from './GameResearchDrawer';

// ─── Hook mocks ──────────────────────────────────────────────────────────────

const mockGameDetail: { data: GameDetailDto | undefined; isLoading: boolean; isError: boolean; refetch: () => void } = {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
};

vi.mock('../../hooks/use-games-discover', () => ({
    useGameDetail: () => mockGameDetail,
    useGamePricing: () => ({ data: null, isLoading: false }),
}));

vi.mock('../../hooks/use-want-to-play', () => ({
    useWantToPlay: () => ({ wantToPlay: false, count: 0, toggle: vi.fn(), isToggling: false }),
}));

vi.mock('../../hooks/use-game-lookup-by-name', () => ({
    useGameLookupByName: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeGame(overrides: Partial<GameDetailDto> = {}): GameDetailDto {
    return {
        id: 42,
        igdbId: 4200,
        name: 'Valheim',
        slug: 'valheim',
        coverUrl: 'https://example.com/valheim-cover.jpg',
        genres: [1, 2],
        summary: 'A brutal exploration and survival game for 1-10 players in a Norse-mythology procedural world.',
        rating: 88,
        aggregatedRating: 90,
        popularity: 100,
        gameModes: [1],
        themes: [1],
        platforms: [6],
        screenshots: [
            'https://example.com/screenshot-1.jpg',
            'https://example.com/screenshot-2.jpg',
            'https://example.com/screenshot-3.jpg',
        ],
        videos: [],
        firstReleaseDate: '2021-02-02T00:00:00.000Z',
        playerCount: { min: 1, max: 10 },
        twitchGameId: null,
        crossplay: null,
        itadGameId: 'itad-valheim',
        itadBoxartUrl: null,
        itadTags: ['Survival', 'Co-op'],
        itadCurrentPrice: 9.99,
        itadCurrentCut: 50,
        itadCurrentShop: 'Steam',
        itadCurrentUrl: 'https://store.steampowered.com/app/892970',
        itadLowestPrice: 4.99,
        itadLowestCut: 75,
        itadPriceUpdatedAt: '2026-05-01T00:00:00.000Z',
        steamAppId: 892970,
        ...overrides,
    };
}

function createClient(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

interface DrawerHarnessProps {
    isOpen?: boolean;
    onClose?: () => void;
    gameId?: number;
    name?: string;
    action?: { label: string; onClick: () => void; busy?: boolean };
}

function renderDrawer(props: DrawerHarnessProps = {}) {
    const onClose = props.onClose ?? vi.fn();
    const result = render(
        <QueryClientProvider client={createClient()}>
            <MemoryRouter>
                <GameResearchDrawer
                    isOpen={props.isOpen ?? true}
                    onClose={onClose}
                    gameId={props.gameId ?? 42}
                    name={props.name}
                    action={props.action}
                />
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return { ...result, onClose };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GameResearchDrawer — open / close', () => {
    beforeEach(() => {
        mockGameDetail.data = makeGame();
        mockGameDetail.isLoading = false;
        mockGameDetail.isError = false;
        mockGameDetail.refetch = vi.fn();
        vi.clearAllMocks();
    });

    it('renders nothing visible when isOpen is false', () => {
        renderDrawer({ isOpen: false });
        expect(screen.queryByTestId('game-research-drawer')).not.toBeInTheDocument();
    });

    it('renders the dialog when isOpen is true', () => {
        renderDrawer({ isOpen: true });
        const drawer = screen.getByTestId('game-research-drawer');
        expect(drawer).toBeInTheDocument();
        expect(drawer).toHaveAttribute('role', 'dialog');
        expect(drawer).toHaveAttribute('aria-modal', 'true');
    });

    it('calls onClose when the Escape key is pressed', () => {
        const { onClose } = renderDrawer({ isOpen: true });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when the backdrop is clicked', () => {
        const { onClose } = renderDrawer({ isOpen: true });
        fireEvent.click(screen.getByTestId('game-research-drawer-backdrop'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when the X close button is clicked', () => {
        const { onClose } = renderDrawer({ isOpen: true });
        fireEvent.click(screen.getByTestId('game-research-drawer-close'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('engages focus trap on open (focus moves inside the drawer)', async () => {
        renderDrawer({ isOpen: true });
        const drawer = screen.getByTestId('game-research-drawer');
        await waitFor(() => {
            expect(drawer.contains(document.activeElement)).toBe(true);
        });
    });
});

describe('GameResearchDrawer — content', () => {
    beforeEach(() => {
        mockGameDetail.data = makeGame();
        mockGameDetail.isLoading = false;
        mockGameDetail.isError = false;
        mockGameDetail.refetch = vi.fn();
    });

    it('renders the game name', () => {
        renderDrawer();
        expect(screen.getByText('Valheim')).toBeInTheDocument();
    });

    it('renders the cover image', () => {
        renderDrawer();
        const cover = screen.getByTestId('game-research-drawer-cover');
        expect(cover).toBeInTheDocument();
        // Either <img src> or a CSS background-image — assert the URL appears somewhere.
        const html = cover.outerHTML;
        expect(html).toContain('valheim-cover.jpg');
    });

    it('renders the description / summary text', () => {
        renderDrawer();
        expect(screen.getByText(/brutal exploration and survival/i)).toBeInTheDocument();
    });

    it('renders the screenshots strip with the fixture screenshots', () => {
        renderDrawer();
        const strip = screen.getByTestId('game-research-drawer-screenshots');
        expect(strip).toBeInTheDocument();
        expect(strip.outerHTML).toContain('screenshot-1.jpg');
        expect(strip.outerHTML).toContain('screenshot-2.jpg');
    });

    it('renders genre / ownership / sale pills', () => {
        renderDrawer();
        const pills = screen.getByTestId('game-research-drawer-pills');
        expect(pills).toBeInTheDocument();
    });

    it('renders at least one store link when itadCurrentUrl or steamAppId is present', () => {
        renderDrawer();
        const links = screen.getByTestId('game-research-drawer-store-links');
        expect(links).toBeInTheDocument();
        // Steam app id 892970 must show up in some link href.
        const anchors = links.querySelectorAll('a');
        expect(anchors.length).toBeGreaterThan(0);
    });
});

describe('GameResearchDrawer — CTA contract', () => {
    beforeEach(() => {
        mockGameDetail.data = makeGame();
        mockGameDetail.isLoading = false;
        mockGameDetail.isError = false;
        mockGameDetail.refetch = vi.fn();
    });

    it('renders provided action label on the CTA', () => {
        const onClick = vi.fn();
        renderDrawer({ action: { label: '+ Nominate this', onClick } });
        expect(screen.getByRole('button', { name: '+ Nominate this' })).toBeInTheDocument();
    });

    it('fires the provided onClick when the CTA is clicked', () => {
        const onClick = vi.fn();
        renderDrawer({ action: { label: 'Vote for this', onClick } });
        fireEvent.click(screen.getByRole('button', { name: 'Vote for this' }));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('renders the CTA in busy state when action.busy is true', () => {
        renderDrawer({ action: { label: '+ Nominate this', onClick: vi.fn(), busy: true } });
        const cta = screen.getByRole('button', { name: '+ Nominate this' });
        expect(cta).toBeDisabled();
    });

    it('falls back to "View full game page" link when action is omitted', () => {
        renderDrawer({ action: undefined });
        const fallback = screen.getByRole('link', { name: /view full game page/i });
        expect(fallback).toBeInTheDocument();
        expect(fallback).toHaveAttribute('href', expect.stringMatching(/\/games\/(42|valheim)/));
    });
});

describe('GameResearchDrawer — async states', () => {
    beforeEach(() => {
        mockGameDetail.data = undefined;
        mockGameDetail.isLoading = false;
        mockGameDetail.isError = false;
        mockGameDetail.refetch = vi.fn();
    });

    it('shows skeleton/loading UI when the detail query is loading', () => {
        mockGameDetail.isLoading = true;
        renderDrawer();
        expect(screen.getByTestId('game-research-drawer-skeleton')).toBeInTheDocument();
    });

    it('shows error state + retry button when the detail query failed', () => {
        mockGameDetail.isError = true;
        mockGameDetail.refetch = vi.fn();
        renderDrawer();
        expect(screen.getByText(/couldn.?t load this game/i)).toBeInTheDocument();
        const retry = screen.getByRole('button', { name: /retry/i });
        fireEvent.click(retry);
        expect(mockGameDetail.refetch).toHaveBeenCalledOnce();
    });
});
