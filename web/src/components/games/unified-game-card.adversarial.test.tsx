/**
 * Adversarial unit tests for UnifiedGameCard — edge cases not covered by
 * the dev-authored test suite (ROK-805).
 *
 * Focus areas:
 * - resolveRating: aggregatedRating vs rating precedence, zero rating
 * - dimWhenInactive behavior on toggle variant
 * - Space key triggering toggle
 * - showInfoBar + compact interaction
 * - HeartButton visibility tied to authentication
 * - Unknown genre/game-mode IDs
 * - Missing optional props
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { UnifiedGameCard } from './unified-game-card';
import type { ItadGamePricingDto } from '@raid-ledger/contract';

// ── Module mocks (overridden per-test via vi.mocked where needed) ─────────────

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: false, user: null }),
}));

vi.mock('../../hooks/use-want-to-play', () => ({
    useWantToPlay: () => ({
        wantToPlay: false,
        count: 0,
        toggle: vi.fn(),
        isToggling: false,
    }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function createGame(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        name: 'Test Game',
        slug: 'test-game',
        coverUrl: 'https://example.com/cover.jpg',
        genres: [] as number[],
        aggregatedRating: null as number | null,
        rating: null as number | null,
        gameModes: [] as number[],
        ...overrides,
    };
}

function createPricing(
    overrides: Partial<ItadGamePricingDto> = {},
): ItadGamePricingDto {
    return {
        currentBest: {
            shop: 'Steam',
            url: 'https://steam.com',
            price: 19.99,
            regularPrice: 39.99,
            discount: 50,
        },
        stores: [],
        historyLow: null,
        dealQuality: 'modest',
        currency: 'USD',
        itadUrl: null,
        ...overrides,
    };
}

function renderCard(ui: React.ReactElement) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// ── resolveRating — aggregatedRating vs rating precedence ─────────────────────

describe('UnifiedGameCard — resolveRating', () => {
    it('prefers aggregatedRating over rating when both present', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createGame({ aggregatedRating: 90, rating: 70 })}
                showRating
            />,
        );
        // aggregatedRating 90 rounds to 90; rating 70 should NOT appear
        expect(screen.getByText('90')).toBeInTheDocument();
        expect(screen.queryByText('70')).not.toBeInTheDocument();
    });

    it('falls back to rating when aggregatedRating is null', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createGame({ aggregatedRating: null, rating: 78 })}
                showRating
            />,
        );
        expect(screen.getByText('78')).toBeInTheDocument();
    });

    it('shows no rating badge when aggregatedRating is 0 (falsy)', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createGame({ aggregatedRating: 0, rating: null })}
                showRating
            />,
        );
        expect(screen.queryByLabelText(/rating/i)).not.toBeInTheDocument();
    });

    it('shows no rating badge when both ratings are null', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createGame({ aggregatedRating: null, rating: null })}
                showRating
            />,
        );
        expect(screen.queryByLabelText(/rating/i)).not.toBeInTheDocument();
    });
});

// ── Toggle variant — keyboard accessibility ───────────────────────────────────

describe('UnifiedGameCard — toggle variant keyboard', () => {
    it('calls onToggle when Space key is pressed', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        renderCard(
            <UnifiedGameCard
                variant="toggle"
                game={createGame()}
                selected={false}
                onToggle={onToggle}
            />,
        );
        screen.getByRole('button').focus();
        await user.keyboard(' ');
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('does not fire onToggle for non-Enter/Space keys', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        renderCard(
            <UnifiedGameCard
                variant="toggle"
                game={createGame()}
                selected={false}
                onToggle={onToggle}
            />,
        );
        screen.getByRole('button').focus();
        await user.keyboard('{Tab}');
        expect(onToggle).not.toHaveBeenCalled();
    });

    it('toggle card is focusable (has tabIndex=0)', () => {
        renderCard(
            <UnifiedGameCard
                variant="toggle"
                game={createGame()}
                selected={false}
                onToggle={vi.fn()}
            />,
        );
        expect(screen.getByRole('button')).toHaveAttribute('tabindex', '0');
    });
});

// ── dimWhenInactive behavior ──────────────────────────────────────────────────

describe('UnifiedGameCard — dimWhenInactive', () => {
    it('renders selected=true without opacity-50 (not dimmed when active)', () => {
        const { container } = renderCard(
            <UnifiedGameCard
                variant="toggle"
                game={createGame()}
                selected={true}
                onToggle={vi.fn()}
                dimWhenInactive
            />,
        );
        // The root div should NOT have opacity-50 when selected=true
        const root = container.firstChild as HTMLElement;
        expect(root.className).not.toContain('opacity-50');
    });

    it('renders selected=false with opacity-50 when dimWhenInactive=true', () => {
        const { container } = renderCard(
            <UnifiedGameCard
                variant="toggle"
                game={createGame()}
                selected={false}
                onToggle={vi.fn()}
                dimWhenInactive
            />,
        );
        const root = container.firstChild as HTMLElement;
        expect(root.className).toContain('opacity-50');
    });

    it('does not apply opacity-50 when dimWhenInactive is false and selected=false', () => {
        const { container } = renderCard(
            <UnifiedGameCard
                variant="toggle"
                game={createGame()}
                selected={false}
                onToggle={vi.fn()}
                dimWhenInactive={false}
            />,
        );
        const root = container.firstChild as HTMLElement;
        expect(root.className).not.toContain('opacity-50');
    });
});

// ── showInfoBar + compact interaction ─────────────────────────────────────────

describe('UnifiedGameCard — showInfoBar and compact', () => {
    it('renders InfoBar when showInfoBar=true and compact=false', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createGame({ gameModes: [1] })}
                showInfoBar
            />,
        );
        // InfoBar renders the mode name "Single" when mode 1 is present
        expect(screen.getByText('Single')).toBeInTheDocument();
    });

    it('does not render InfoBar when showInfoBar=true but compact=true', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createGame({ gameModes: [1] })}
                showInfoBar
                compact
            />,
        );
        // Compact suppresses the InfoBar even when showInfoBar is true
        expect(screen.queryByText('Single')).not.toBeInTheDocument();
    });

    it('does not render InfoBar when showInfoBar is not passed (default false)', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createGame({ gameModes: [1] })}
            />,
        );
        expect(screen.queryByText('Single')).not.toBeInTheDocument();
    });
});

// ── Unknown genre / game mode IDs ─────────────────────────────────────────────

describe('UnifiedGameCard — unknown IGDB ids', () => {
    it('shows no genre badge for an unknown genre id', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createGame({ genres: [9999] })}
            />,
        );
        // GENRE_MAP has no entry for 9999 → no genre badge rendered
        expect(screen.queryByText(/rpg|shooter|adventure/i)).not.toBeInTheDocument();
    });

    it('shows no mode in InfoBar for an unknown mode id', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createGame({ gameModes: [9999] })}
                showInfoBar
            />,
        );
        // MODE_MAP has no entry for 9999 → InfoBar renders nothing for mode
        expect(screen.queryByText(/single|multi|co-op/i)).not.toBeInTheDocument();
    });
});

// ── Pricing edge cases ────────────────────────────────────────────────────────

describe('UnifiedGameCard — pricing edge cases', () => {
    it('shows no badge when pricing is undefined (not passed at all)', () => {
        renderCard(
            <UnifiedGameCard variant="link" game={createGame()} />,
        );
        expect(screen.queryByText('On Sale')).not.toBeInTheDocument();
        expect(screen.queryByText('Best Price')).not.toBeInTheDocument();
    });

    it('shows no badge when discount is exactly 0', () => {
        const zeroPricing = createPricing({
            currentBest: {
                shop: 'Steam',
                url: '',
                price: 39.99,
                regularPrice: 39.99,
                discount: 0,
            },
        });
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createGame()}
                pricing={zeroPricing}
            />,
        );
        expect(screen.queryByText('On Sale')).not.toBeInTheDocument();
    });

    it('shows "Best Price" when current price equals historyLow price', () => {
        const bestPricePricing = createPricing({
            currentBest: {
                shop: 'Steam',
                url: '',
                price: 9.99,
                regularPrice: 39.99,
                discount: 75,
            },
            historyLow: {
                price: 9.99,
                shop: 'Steam',
                date: '2024-01-01T00:00:00Z',
            },
        });
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createGame()}
                pricing={bestPricePricing}
            />,
        );
        expect(screen.getByText('Best Price')).toBeInTheDocument();
    });
});

// ── Toggle variant — HeartIcon shows selection state ─────────────────────────

describe('UnifiedGameCard — toggle HeartIcon', () => {
    it('renders HeartIcon in the toggle variant (not a button)', () => {
        const { container } = renderCard(
            <UnifiedGameCard
                variant="toggle"
                game={createGame()}
                selected={true}
                onToggle={vi.fn()}
            />,
        );
        // HeartIcon renders as a div wrapper around an svg, no button
        expect(container.querySelector('button')).toBeNull();
        expect(container.querySelector('svg')).not.toBeNull();
    });
});

// ── Minimal game props (optional fields absent) ───────────────────────────────

describe('UnifiedGameCard — minimal game props', () => {
    it('renders with no genres, no gameModes, no ratings', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={{
                    id: 99,
                    name: 'Minimal Game',
                    slug: 'minimal-game',
                    coverUrl: null,
                }}
                showRating
                showInfoBar
            />,
        );
        expect(screen.getByText('Minimal Game')).toBeInTheDocument();
        // No crashes from missing optional arrays
    });

    it('renders link to correct id when id is a large number', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createGame({ id: 9999999 })}
            />,
        );
        expect(screen.getByRole('link')).toHaveAttribute(
            'href',
            '/games/9999999',
        );
    });
});
