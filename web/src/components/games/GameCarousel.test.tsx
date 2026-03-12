/**
 * Adversarial unit tests for GameCarousel component (ROK-800).
 * Verifies GameCarousel accepts a pricingMap and passes pricing to each GameCard.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameCarousel } from './GameCarousel';
import type { GameDetailDto, ItadGamePricingDto } from '@raid-ledger/contract';

// Mock auth hook — unauthenticated to keep tests simple
vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: false, user: null }),
}));

// Mock want-to-play hook (used by UnifiedGameCard)
vi.mock('../../hooks/use-want-to-play', () => ({
    useWantToPlay: () => ({
        wantToPlay: false,
        count: 0,
        toggle: vi.fn(),
        isToggling: false,
    }),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

function createMockGame(
    id: number,
    name: string,
    overrides: Partial<GameDetailDto> = {},
): GameDetailDto {
    return {
        id,
        igdbId: id * 10,
        name,
        slug: name.toLowerCase().replace(/\s/g, '-'),
        coverUrl: `https://example.com/${id}.jpg`,
        genres: [],
        gameModes: [],
        summary: 'A game',
        rating: null,
        aggregatedRating: null,
        popularity: null,
        themes: [],
        platforms: [],
        screenshots: [],
        videos: [],
        firstReleaseDate: null,
        playerCount: null,
        twitchGameId: null,
        crossplay: null,
        ...overrides,
    };
}

function createMockPricing(
    price: number,
    discount: number,
): ItadGamePricingDto {
    return {
        currentBest: {
            shop: 'Steam',
            url: 'https://steam.com',
            price,
            regularPrice: price * 2,
            discount,
        },
        stores: [],
        historyLow: null,
        dealQuality: discount > 0 ? 'modest' : null,
        currency: 'USD',
        itadUrl: null,
    };
}

function renderWithRouter(ui: React.ReactElement) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// ─── Basic rendering ──────────────────────────────────────────────────────────

describe('GameCarousel — basic rendering (ROK-800)', () => {
    it('renders the category heading', () => {
        const games = [createMockGame(1, 'Valheim')];
        renderWithRouter(
            <GameCarousel category="Top Rated" games={games} />,
        );
        expect(screen.getByText('Top Rated')).toBeInTheDocument();
    });

    it('renders a card for each game', () => {
        const games = [
            createMockGame(1, 'Game One'),
            createMockGame(2, 'Game Two'),
            createMockGame(3, 'Game Three'),
        ];
        renderWithRouter(<GameCarousel category="Popular" games={games} />);
        expect(screen.getByText('Game One')).toBeInTheDocument();
        expect(screen.getByText('Game Two')).toBeInTheDocument();
        expect(screen.getByText('Game Three')).toBeInTheDocument();
    });

    it('renders nothing when games array is empty', () => {
        const { container } = renderWithRouter(
            <GameCarousel category="Empty Row" games={[]} />,
        );
        expect(container.firstChild).toBeNull();
    });
});

// ─── AC: GameCarousel passes pricing from pricingMap to each GameCard ─────────

describe('GameCarousel — pricingMap prop (ROK-800)', () => {
    it('renders "On Sale" badge for a game that has a discount in the pricingMap', () => {
        const game = createMockGame(10, 'Discounted Game');
        const pricingMap = new Map<number, ItadGamePricingDto | null>([
            [10, createMockPricing(19.99, 50)],
        ]);

        renderWithRouter(
            <GameCarousel category="Deals" games={[game]} pricingMap={pricingMap} />,
        );

        expect(screen.getByText('On Sale')).toBeInTheDocument();
    });

    it('does not show price badge for a game with null pricing in the pricingMap', () => {
        const game = createMockGame(20, 'Full Price Game');
        const pricingMap = new Map<number, ItadGamePricingDto | null>([
            [20, null],
        ]);

        renderWithRouter(
            <GameCarousel category="Popular" games={[game]} pricingMap={pricingMap} />,
        );

        expect(screen.queryByText('On Sale')).not.toBeInTheDocument();
        expect(screen.queryByText('Best Price')).not.toBeInTheDocument();
    });

    it('does not show price badge for a game not found in the pricingMap', () => {
        const game = createMockGame(30, 'Unmapped Game');
        const pricingMap = new Map<number, ItadGamePricingDto | null>([
            [99, createMockPricing(9.99, 50)], // different game ID
        ]);

        renderWithRouter(
            <GameCarousel category="Popular" games={[game]} pricingMap={pricingMap} />,
        );

        expect(screen.queryByText('On Sale')).not.toBeInTheDocument();
    });

    it('shows price badges for games with discounts and none for games without', () => {
        const games = [
            createMockGame(1, 'Sale Game'),
            createMockGame(2, 'Full Price Game'),
        ];
        const pricingMap = new Map<number, ItadGamePricingDto | null>([
            [1, createMockPricing(14.99, 50)],
            [2, null],
        ]);

        renderWithRouter(
            <GameCarousel category="Mixed" games={games} pricingMap={pricingMap} />,
        );

        // One badge for the discounted game
        expect(screen.getAllByText('On Sale')).toHaveLength(1);
    });

    it('renders without pricingMap prop (no price badges shown)', () => {
        const games = [createMockGame(5, 'Some Game')];

        renderWithRouter(<GameCarousel category="Popular" games={games} />);

        expect(screen.queryByText('On Sale')).not.toBeInTheDocument();
        expect(screen.queryByText('Best Price')).not.toBeInTheDocument();
        expect(screen.getByText('Some Game')).toBeInTheDocument();
    });

    it('handles pricingMap with multiple games and shows correct badges per game', () => {
        const games = [
            createMockGame(100, 'Alpha'),
            createMockGame(101, 'Beta'),
            createMockGame(102, 'Gamma'),
        ];
        const pricingMap = new Map<number, ItadGamePricingDto | null>([
            [100, createMockPricing(9.99, 80)],
            [101, null],
            [102, createMockPricing(24.99, 25)],
        ]);

        renderWithRouter(
            <GameCarousel category="Top Games" games={games} pricingMap={pricingMap} />,
        );

        // 2 games have discounts (100 and 102)
        expect(screen.getAllByText('On Sale')).toHaveLength(2);
    });
});

// ─── GameCarousel — scroll arrow accessibility ─────────────────────────────────

describe('GameCarousel — scroll arrows (ROK-800)', () => {
    it('renders game cards with accessible links', () => {
        const games = [createMockGame(1, 'Link Test Game')];
        renderWithRouter(<GameCarousel category="Test" games={games} />);
        const link = screen.getByRole('link', { name: /link test game/i });
        expect(link).toHaveAttribute('href', '/games/1');
    });
});
