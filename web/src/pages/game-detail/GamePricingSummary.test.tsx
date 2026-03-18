/**
 * Unit tests for GamePricingSummary component (ROK-419).
 * Verifies pricing display, ITAD link, historical low, and graceful degradation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GamePricingSummary } from './GamePricingSummary';
import type { ItadGamePricingDto } from '@raid-ledger/contract';

function buildPricing(overrides: Partial<ItadGamePricingDto> = {}): ItadGamePricingDto {
    return {
        currentBest: { shop: 'Steam', url: 'https://steam.com', price: 29.99, regularPrice: 59.99, discount: 50 },
        stores: [{ shop: 'Steam', url: 'https://steam.com', price: 29.99, regularPrice: 59.99, discount: 50 }],
        historyLow: { price: 14.99, shop: 'Steam', date: '2024-11-25T00:00:00Z' },
        dealQuality: 'modest',
        currency: 'USD',
        itadUrl: 'https://isthereanydeal.com/game/test/',
        ...overrides,
    };
}

describe('GamePricingSummary — pricing display', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders the current best price', () => {
        render(<GamePricingSummary pricing={buildPricing()} />);
        expect(screen.getByText('$29.99')).toBeInTheDocument();
    });

    it('renders the regular price with strikethrough when discounted', () => {
        render(<GamePricingSummary pricing={buildPricing()} />);
        const regular = screen.getByText('$59.99');
        expect(regular).toBeInTheDocument();
        expect(regular).toHaveClass('line-through');
    });

    it('renders discount percentage badge', () => {
        render(<GamePricingSummary pricing={buildPricing()} />);
        expect(screen.getByText('-50%')).toBeInTheDocument();
    });

    it('does not render discount elements when discount is 0', () => {
        render(<GamePricingSummary pricing={buildPricing({
            currentBest: { shop: 'Steam', url: '', price: 59.99, regularPrice: 59.99, discount: 0 },
        })} />);
        expect(screen.queryByText(/-\d+%/)).not.toBeInTheDocument();
    });

    it('renders nothing when currentBest is null', () => {
        const { container } = render(<GamePricingSummary pricing={buildPricing({ currentBest: null })} />);
        expect(container.firstChild).toBeNull();
    });
});

describe('GamePricingSummary — ITAD link', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders link to IsThereAnyDeal', () => {
        render(<GamePricingSummary pricing={buildPricing()} />);
        const link = screen.getByRole('link', { name: /isthereanydeal/i });
        expect(link).toHaveAttribute('href', 'https://isthereanydeal.com/game/test/');
    });

    it('opens ITAD link in new tab', () => {
        render(<GamePricingSummary pricing={buildPricing()} />);
        const link = screen.getByRole('link', { name: /isthereanydeal/i });
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('does not render ITAD link when itadUrl is null', () => {
        render(<GamePricingSummary pricing={buildPricing({ itadUrl: null })} />);
        expect(screen.queryByRole('link', { name: /isthereanydeal/i })).not.toBeInTheDocument();
    });
});

describe('GamePricingSummary — historical low', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders historical low price', () => {
        render(<GamePricingSummary pricing={buildPricing()} />);
        expect(screen.getByText('$14.99')).toBeInTheDocument();
    });

    it('renders historical low label', () => {
        render(<GamePricingSummary pricing={buildPricing()} />);
        expect(screen.getByText(/historical low/i)).toBeInTheDocument();
    });

    it('renders historical low shop name', () => {
        render(<GamePricingSummary pricing={buildPricing()} />);
        expect(screen.getByText(/at steam/i)).toBeInTheDocument();
    });

    it('renders historical low date', () => {
        render(<GamePricingSummary pricing={buildPricing()} />);
        expect(screen.getByText(/nov/i)).toBeInTheDocument();
    });

    it('hides historical low when historyLow is null', () => {
        render(<GamePricingSummary pricing={buildPricing({ historyLow: null })} />);
        expect(screen.queryByText(/historical low/i)).not.toBeInTheDocument();
    });
});

describe('GamePricingSummary — price badge', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows "On Sale" badge when discounted above historical low', () => {
        render(<GamePricingSummary pricing={buildPricing()} />);
        expect(screen.getByText('On Sale')).toBeInTheDocument();
    });

    it('shows "Best Price" badge when at historical low', () => {
        render(<GamePricingSummary pricing={buildPricing({
            currentBest: { shop: 'Steam', url: '', price: 14.99, regularPrice: 59.99, discount: 75 },
            historyLow: { price: 14.99, shop: 'Steam', date: '2024-01-01' },
        })} />);
        expect(screen.getByText('Best Price')).toBeInTheDocument();
    });
});

// ─── GamePricingSummary — DB-cache null fields (ROK-854) ─────────────────────

describe('GamePricingSummary — DB-cache null fields (ROK-854)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does not render regular price when regularPrice is null', () => {
        render(<GamePricingSummary pricing={buildPricing({
            currentBest: { shop: 'Steam', url: 'https://steam.com', price: 9.99, regularPrice: null, discount: 50 },
        })} />);
        // Current price renders
        expect(screen.getByText('$9.99')).toBeInTheDocument();
        // No struck-through regular price
        expect(screen.queryByText(/\$59\.99/)).not.toBeInTheDocument();
        // Discount badge still shows
        expect(screen.getByText('-50%')).toBeInTheDocument();
    });

    it('does not render shop name when historyLow.shop is null', () => {
        render(<GamePricingSummary pricing={buildPricing({
            historyLow: { price: 4.99, shop: null, date: '2024-11-25T00:00:00Z' },
        })} />);
        expect(screen.getByText(/historical low/i)).toBeInTheDocument();
        // Price is still shown
        expect(screen.getByText('$4.99')).toBeInTheDocument();
        // "at <shop>" fragment is absent
        expect(screen.queryByText(/at /i)).not.toBeInTheDocument();
    });

    it('does not render date when historyLow.date is null', () => {
        render(<GamePricingSummary pricing={buildPricing({
            historyLow: { price: 4.99, shop: 'Steam', date: null },
        })} />);
        expect(screen.getByText(/historical low/i)).toBeInTheDocument();
        // No date in parentheses
        expect(screen.queryByText(/\(/)).not.toBeInTheDocument();
    });

    it('renders only the historical low price when both shop and date are null', () => {
        render(<GamePricingSummary pricing={buildPricing({
            historyLow: { price: 2.99, shop: null, date: null },
        })} />);
        expect(screen.getByText('$2.99')).toBeInTheDocument();
        expect(screen.queryByText(/at /i)).not.toBeInTheDocument();
        expect(screen.queryByText(/\(/)).not.toBeInTheDocument();
    });
});
