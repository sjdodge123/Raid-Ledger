/**
 * Unit tests for UnifiedGameCard component (ROK-805).
 * Tests both "link" and "toggle" variants, pricing badges,
 * compact mode, rating display, and dimWhenInactive behavior.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { UnifiedGameCard } from './unified-game-card';
import type { ItadGamePricingDto } from '@raid-ledger/contract';

// Mock auth hook — unauthenticated by default
vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: false, user: null }),
}));

// Mock want-to-play hook
vi.mock('../../hooks/use-want-to-play', () => ({
    useWantToPlay: () => ({
        wantToPlay: false,
        count: 0,
        toggle: vi.fn(),
        isToggling: false,
    }),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

function createBaseGame(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        name: 'Elden Ring',
        slug: 'elden-ring',
        coverUrl: 'https://example.com/cover.jpg',
        genres: [12],
        aggregatedRating: 95,
        rating: 92,
        gameModes: [1],
        ...overrides,
    };
}

function createMockPricing(
    overrides: Partial<ItadGamePricingDto> = {},
): ItadGamePricingDto {
    return {
        currentBest: {
            shop: 'Steam',
            url: 'https://steam.com/app/1',
            price: 29.99,
            regularPrice: 59.99,
            discount: 50,
        },
        stores: [],
        historyLow: {
            price: 14.99,
            shop: 'Steam',
            date: '2024-11-25T00:00:00Z',
        },
        dealQuality: 'modest',
        currency: 'USD',
        itadUrl: null,
        ...overrides,
    };
}

function renderCard(ui: React.ReactElement) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// ── Link variant ─────────────────────────────────────────────────────────────

describe('UnifiedGameCard — link variant', () => {
    it('renders the game name', () => {
        renderCard(
            <UnifiedGameCard variant="link" game={createBaseGame()} />,
        );
        expect(screen.getByText('Elden Ring')).toBeInTheDocument();
    });

    it('renders as a link to the game detail page', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame({ id: 42 })}
            />,
        );
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', '/games/42');
    });

    it('renders the cover image when coverUrl is present', () => {
        renderCard(
            <UnifiedGameCard variant="link" game={createBaseGame()} />,
        );
        const img = screen.getByAltText('Elden Ring');
        expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg');
    });

    it('renders a placeholder when coverUrl is null', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame({ coverUrl: null })}
            />,
        );
        expect(screen.queryByAltText('Elden Ring')).not.toBeInTheDocument();
    });

    it('shows "On Sale" badge when pricing has a discount', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame()}
                pricing={createMockPricing()}
            />,
        );
        expect(screen.getByText('On Sale')).toBeInTheDocument();
    });

    it('shows "Best Price" badge when at historical low', () => {
        const pricing = createMockPricing({
            currentBest: {
                shop: 'Steam',
                url: '',
                price: 14.99,
                regularPrice: 59.99,
                discount: 75,
            },
            historyLow: {
                price: 14.99,
                shop: 'Steam',
                date: '2024-11-25T00:00:00Z',
            },
        });
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame()}
                pricing={pricing}
            />,
        );
        expect(screen.getByText('Best Price')).toBeInTheDocument();
    });

    it('does not show a price badge when pricing is null', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame()}
                pricing={null}
            />,
        );
        expect(screen.queryByText('On Sale')).not.toBeInTheDocument();
        expect(screen.queryByText('Best Price')).not.toBeInTheDocument();
    });
});

// ── Toggle variant ───────────────────────────────────────────────────────────

describe('UnifiedGameCard — toggle variant', () => {
    it('renders the game name', () => {
        renderCard(
            <UnifiedGameCard
                variant="toggle"
                game={createBaseGame()}
                selected={false}
                onToggle={vi.fn()}
            />,
        );
        expect(screen.getByText('Elden Ring')).toBeInTheDocument();
    });

    it('renders as a div with role="button"', () => {
        renderCard(
            <UnifiedGameCard
                variant="toggle"
                game={createBaseGame()}
                selected={false}
                onToggle={vi.fn()}
            />,
        );
        expect(screen.getByRole('button')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('calls onToggle when clicked', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        renderCard(
            <UnifiedGameCard
                variant="toggle"
                game={createBaseGame()}
                selected={false}
                onToggle={onToggle}
            />,
        );
        await user.click(screen.getByRole('button'));
        expect(onToggle).toHaveBeenCalled();
    });

    it('calls onToggle when Enter key is pressed', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        renderCard(
            <UnifiedGameCard
                variant="toggle"
                game={createBaseGame()}
                selected={false}
                onToggle={onToggle}
            />,
        );
        screen.getByRole('button').focus();
        await user.keyboard('{Enter}');
        expect(onToggle).toHaveBeenCalled();
    });
});

// ── Compact mode ─────────────────────────────────────────────────────────────

describe('UnifiedGameCard — compact mode', () => {
    it('renders without crashing in compact mode', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame()}
                compact
            />,
        );
        expect(screen.getByText('Elden Ring')).toBeInTheDocument();
    });
});

// ── Rating display ───────────────────────────────────────────────────────────

describe('UnifiedGameCard — rating', () => {
    it('shows rating badge when showRating is true and rating exists', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame({ aggregatedRating: 85 })}
                showRating
            />,
        );
        expect(screen.getByText('85')).toBeInTheDocument();
    });

    it('does not show rating badge when showRating is false', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame({ aggregatedRating: 85 })}
            />,
        );
        expect(screen.queryByText('85')).not.toBeInTheDocument();
    });

    it('does not show rating badge when rating is null', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame({
                    aggregatedRating: null,
                    rating: null,
                })}
                showRating
            />,
        );
        // No numeric badge should appear
        expect(screen.queryByLabelText(/rating/i)).not.toBeInTheDocument();
    });
});

// ── Genre badge ──────────────────────────────────────────────────────────────

describe('UnifiedGameCard — genre badge', () => {
    it('shows genre badge when game has genres', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame({ genres: [12] })}
            />,
        );
        expect(screen.getByText('RPG')).toBeInTheDocument();
    });

    it('does not show genre badge when genres are empty', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame({ genres: [] })}
            />,
        );
        expect(screen.queryByText('RPG')).not.toBeInTheDocument();
    });
});
