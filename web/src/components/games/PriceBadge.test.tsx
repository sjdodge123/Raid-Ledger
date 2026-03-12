/**
 * Unit tests for PriceBadge component and getPriceBadgeType helper (ROK-419).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriceBadge } from './PriceBadge';
import { getPriceBadgeType } from './price-badge.helpers';
import type { ItadGamePricingDto } from '@raid-ledger/contract';

function buildPricing(overrides: Partial<ItadGamePricingDto> = {}): ItadGamePricingDto {
    return {
        currentBest: { shop: 'Steam', url: 'https://steam.com', price: 29.99, regularPrice: 59.99, discount: 50 },
        stores: [],
        historyLow: { price: 14.99, shop: 'Steam', date: '2024-11-25T00:00:00Z' },
        dealQuality: 'modest',
        currency: 'USD',
        itadUrl: null,
        ...overrides,
    };
}

describe('getPriceBadgeType', () => {
    it('returns null when pricing is null', () => {
        expect(getPriceBadgeType(null)).toBeNull();
    });

    it('returns null when currentBest is null', () => {
        expect(getPriceBadgeType(buildPricing({ currentBest: null }))).toBeNull();
    });

    it('returns null when discount is 0', () => {
        expect(getPriceBadgeType(buildPricing({
            currentBest: { shop: 'Steam', url: '', price: 59.99, regularPrice: 59.99, discount: 0 },
        }))).toBeNull();
    });

    it('returns "best-price" when current price equals historical low', () => {
        expect(getPriceBadgeType(buildPricing({
            currentBest: { shop: 'Steam', url: '', price: 14.99, regularPrice: 59.99, discount: 75 },
            historyLow: { price: 14.99, shop: 'Steam', date: '2024-01-01' },
        }))).toBe('best-price');
    });

    it('returns "best-price" when current price is below historical low', () => {
        expect(getPriceBadgeType(buildPricing({
            currentBest: { shop: 'Steam', url: '', price: 9.99, regularPrice: 59.99, discount: 83 },
            historyLow: { price: 14.99, shop: 'Steam', date: '2024-01-01' },
        }))).toBe('best-price');
    });

    it('returns "on-sale" when discounted but above historical low', () => {
        expect(getPriceBadgeType(buildPricing())).toBe('on-sale');
    });

    it('returns "on-sale" when discounted with no historical low', () => {
        expect(getPriceBadgeType(buildPricing({ historyLow: null }))).toBe('on-sale');
    });
});

describe('PriceBadge', () => {
    it('renders "Best Price" for best-price type', () => {
        const pricing = buildPricing({
            currentBest: { shop: 'Steam', url: '', price: 14.99, regularPrice: 59.99, discount: 75 },
            historyLow: { price: 14.99, shop: 'Steam', date: '2024-01-01' },
        });
        render(<PriceBadge pricing={pricing} />);
        expect(screen.getByText('Best Price')).toBeInTheDocument();
    });

    it('renders "On Sale" for on-sale type', () => {
        render(<PriceBadge pricing={buildPricing()} />);
        expect(screen.getByText('On Sale')).toBeInTheDocument();
    });

    it('renders nothing when pricing is null', () => {
        const { container } = render(<PriceBadge pricing={null} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when no discount', () => {
        const pricing = buildPricing({
            currentBest: { shop: 'Steam', url: '', price: 59.99, regularPrice: 59.99, discount: 0 },
        });
        const { container } = render(<PriceBadge pricing={pricing} />);
        expect(container.firstChild).toBeNull();
    });

    it('applies custom className', () => {
        render(<PriceBadge pricing={buildPricing()} className="custom-class" />);
        expect(screen.getByText('On Sale')).toHaveClass('custom-class');
    });
});
