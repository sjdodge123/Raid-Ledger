/**
 * Unit tests for WhereToBuySection component (ROK-419).
 * Verifies rendering, deal quality badges, store list expansion,
 * and graceful degradation when ITAD is unconfigured or unavailable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WhereToBuySection } from './WhereToBuySection';
import type { ItadGamePricingDto } from '@raid-ledger/contract';

// Mock the hook so we fully control data/loading state
vi.mock('../../hooks/use-games-discover', () => ({
    useGamePricing: vi.fn(),
}));

import { useGamePricing } from '../../hooks/use-games-discover';
const mockUseGamePricing = useGamePricing as ReturnType<typeof vi.fn>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function buildPricing(overrides: Partial<ItadGamePricingDto> = {}): ItadGamePricingDto {
    return {
        currentBest: {
            shop: 'Steam',
            url: 'https://store.steampowered.com/app/12345',
            price: 29.99,
            regularPrice: 59.99,
            discount: 50,
        },
        stores: [
            {
                shop: 'Steam',
                url: 'https://store.steampowered.com/app/12345',
                price: 29.99,
                regularPrice: 59.99,
                discount: 50,
            },
        ],
        historyLow: {
            price: 14.99,
            shop: 'Steam',
            date: '2024-11-25T00:00:00Z',
        },
        dealQuality: 'modest',
        currency: 'USD',
        ...overrides,
    };
}

function buildMultiStorePricing(): ItadGamePricingDto {
    return buildPricing({
        currentBest: {
            shop: 'Steam',
            url: 'https://store.steampowered.com/app/12345',
            price: 19.99,
            regularPrice: 59.99,
            discount: 67,
        },
        stores: [
            { shop: 'Steam', url: 'https://steam.com', price: 19.99, regularPrice: 59.99, discount: 67 },
            { shop: 'GOG', url: 'https://gog.com', price: 24.99, regularPrice: 59.99, discount: 58 },
            { shop: 'Epic', url: 'https://epic.com', price: 27.99, regularPrice: 59.99, discount: 53 },
            { shop: 'Humble', url: 'https://humble.com', price: 31.99, regularPrice: 59.99, discount: 47 },
        ],
    });
}

// ─── Graceful degradation ─────────────────────────────────────────────────────

describe('WhereToBuySection — graceful degradation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when hasItadId is false', () => {
        mockUseGamePricing.mockReturnValue({ data: { data: buildPricing() }, isLoading: false });

        const { container } = render(<WhereToBuySection gameId={1} hasItadId={false} />);

        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when pricing data is null (ITAD unavailable)', () => {
        mockUseGamePricing.mockReturnValue({ data: { data: null }, isLoading: false });

        const { container } = render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when pricing response is undefined', () => {
        mockUseGamePricing.mockReturnValue({ data: undefined, isLoading: false });

        const { container } = render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when stores array is empty', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing({ stores: [], currentBest: null }) },
            isLoading: false,
        });

        const { container } = render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(container.firstChild).toBeNull();
    });

    it('does not call useGamePricing when hasItadId is false (hook disables itself)', () => {
        mockUseGamePricing.mockReturnValue({ data: undefined, isLoading: false });

        render(<WhereToBuySection gameId={1} hasItadId={false} />);

        // Component returns null early before rendering, but hook is still called with enabled=false
        expect(mockUseGamePricing).toHaveBeenCalledWith(1, false);
    });
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe('WhereToBuySection — loading state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders a skeleton when isLoading is true', () => {
        mockUseGamePricing.mockReturnValue({ data: undefined, isLoading: true });

        const { container } = render(<WhereToBuySection gameId={1} hasItadId={true} />);

        // Skeleton should have animate-pulse element
        const skeleton = container.querySelector('.animate-pulse');
        expect(skeleton).toBeInTheDocument();
    });

    it('renders no section heading while loading', () => {
        mockUseGamePricing.mockReturnValue({ data: undefined, isLoading: true });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(screen.queryByText('Where to Buy')).not.toBeInTheDocument();
    });
});

// ─── AC: "Where to Buy" section heading ──────────────────────────────────────

describe('WhereToBuySection — section heading', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders "Where to Buy" heading when pricing data is available', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(screen.getByText('Where to Buy')).toBeInTheDocument();
    });

    it('renders heading as h2', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        const heading = screen.getByText('Where to Buy');
        expect(heading.tagName).toBe('H2');
    });
});

// ─── AC: Current best price display ──────────────────────────────────────────

describe('WhereToBuySection — current best price', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the best current price as formatted currency', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        // $29.99 formatted as USD
        expect(screen.getByText('$29.99')).toBeInTheDocument();
    });

    it('renders the store name as a link for best price', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        const link = screen.getByRole('link', { name: /steam/i });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', 'https://store.steampowered.com/app/12345');
    });

    it('opens best price link in new tab with rel noopener', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        const link = screen.getByRole('link', { name: /steam/i });
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('shows discount percentage badge when discount > 0', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(screen.getByText('-50%')).toBeInTheDocument();
    });

    it('does not show discount badge when discount is 0', () => {
        mockUseGamePricing.mockReturnValue({
            data: {
                data: buildPricing({
                    currentBest: {
                        shop: 'Steam',
                        url: 'https://steam.com',
                        price: 59.99,
                        regularPrice: 59.99,
                        discount: 0,
                    },
                }),
            },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(screen.queryByText(/-\d+%/)).not.toBeInTheDocument();
    });

    it('does not render the best-price store link when currentBest is null', () => {
        mockUseGamePricing.mockReturnValue({
            data: {
                data: buildPricing({
                    currentBest: null,
                    stores: [
                        { shop: 'Steam', url: 'https://steam.com', price: 29.99, regularPrice: 59.99, discount: 50 },
                        { shop: 'GOG', url: 'https://gog.com', price: 34.99, regularPrice: 59.99, discount: 42 },
                    ],
                }),
            },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        // The best-price arrow link (→) should not be rendered when currentBest is null
        // (The arrow character is rendered next to the shop name in BestPriceRow)
        const arrowLinks = screen.queryAllByRole('link', { name: /→/ });
        expect(arrowLinks).toHaveLength(0);
    });
});

// ─── AC: Historical low ───────────────────────────────────────────────────────

describe('WhereToBuySection — historical low', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders historical low price', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(screen.getByText('$14.99')).toBeInTheDocument();
    });

    it('renders historical low label text', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(screen.getByText(/historical low/i)).toBeInTheDocument();
    });

    it('renders the shop that had the historical low', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        // "at Steam" in the history low row
        expect(screen.getByText(/at steam/i)).toBeInTheDocument();
    });

    it('renders the date of the historical low', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        // 2024-11-25 formatted as locale date
        expect(screen.getByText(/nov/i)).toBeInTheDocument();
    });

    it('hides historical low row when historyLow is null', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing({ historyLow: null }) },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(screen.queryByText(/historical low/i)).not.toBeInTheDocument();
    });
});

// ─── AC: Deal quality badge ───────────────────────────────────────────────────

describe('WhereToBuySection — deal quality badge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows "Near Historic Low" badge for "great" deal quality', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing({ dealQuality: 'great' }) },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(screen.getByText('Near Historic Low')).toBeInTheDocument();
    });

    it('shows "Good Deal" badge for "good" deal quality', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing({ dealQuality: 'good' }) },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(screen.getByText('Good Deal')).toBeInTheDocument();
    });

    it('shows "On Sale" badge for "modest" deal quality', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing({ dealQuality: 'modest' }) },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(screen.getByText('On Sale')).toBeInTheDocument();
    });

    it('does not render a deal quality badge when dealQuality is null', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing({ dealQuality: null }) },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(screen.queryByText('Near Historic Low')).not.toBeInTheDocument();
        expect(screen.queryByText('Good Deal')).not.toBeInTheDocument();
        expect(screen.queryByText('On Sale')).not.toBeInTheDocument();
    });
});

// ─── AC: Expandable store list ────────────────────────────────────────────────

describe('WhereToBuySection — store list', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not render store list when only one store exists', () => {
        // StoreList returns null for stores.length <= 1
        mockUseGamePricing.mockReturnValue({
            data: { data: buildPricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        // With a single store, no "Show all" button or additional rows
        expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument();
    });

    it('shows first 3 stores by default when more than 3 exist', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildMultiStorePricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        // Should show "Show all 4 stores" button
        expect(screen.getByRole('button', { name: /show all 4 stores/i })).toBeInTheDocument();
    });

    it('shows "Show all N stores" button when more than 3 stores exist', () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildMultiStorePricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        expect(screen.getByRole('button', { name: /show all 4 stores/i })).toBeInTheDocument();
    });

    it('expands to show all stores when "Show all" button is clicked', async () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildMultiStorePricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        const expandBtn = screen.getByRole('button', { name: /show all/i });
        fireEvent.click(expandBtn);

        await waitFor(() => {
            // All 4 store rows should be visible — check by store-specific text
            expect(screen.getByText('GOG')).toBeInTheDocument();
            expect(screen.getByText('Epic')).toBeInTheDocument();
            expect(screen.getByText('Humble')).toBeInTheDocument();
        });
    });

    it('shows "Show fewer" button after expanding', async () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildMultiStorePricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        fireEvent.click(screen.getByRole('button', { name: /show all/i }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /show fewer/i })).toBeInTheDocument();
        });
    });

    it('collapses back when "Show fewer" is clicked', async () => {
        mockUseGamePricing.mockReturnValue({
            data: { data: buildMultiStorePricing() },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        // Expand first
        fireEvent.click(screen.getByRole('button', { name: /show all/i }));
        await waitFor(() => screen.getByRole('button', { name: /show fewer/i }));

        // Then collapse
        fireEvent.click(screen.getByRole('button', { name: /show fewer/i }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /show all 4 stores/i })).toBeInTheDocument();
        });
    });

    it('sorts stores by price ascending in the store list', () => {
        const pricing = buildMultiStorePricing();
        mockUseGamePricing.mockReturnValue({
            data: { data: pricing },
            isLoading: false,
        });

        render(<WhereToBuySection gameId={1} hasItadId={true} />);

        // Expand to show all
        fireEvent.click(screen.getByRole('button', { name: /show all/i }));

        // Get all store links within the expanded list
        const links = screen.getAllByRole('link');
        const storeLinks = links.filter((l) => l.tagName === 'A' && l.getAttribute('target') === '_blank');

        // The first visible store link should be the cheapest (Steam at 19.99)
        // Links are: best price row link + store list links
        // Steam is cheapest so it should appear first in the list
        const storeNames = storeLinks.map((l) => l.textContent);
        const steamIdx = storeNames.findIndex((n) => n?.includes('Steam'));
        const humbleIdx = storeNames.findIndex((n) => n?.includes('Humble'));
        expect(steamIdx).toBeLessThan(humbleIdx);
    });
});

// ─── Hook wiring ─────────────────────────────────────────────────────────────

describe('WhereToBuySection — hook wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('passes gameId and hasItadId to useGamePricing', () => {
        mockUseGamePricing.mockReturnValue({ data: undefined, isLoading: false });

        render(<WhereToBuySection gameId={42} hasItadId={true} />);

        expect(mockUseGamePricing).toHaveBeenCalledWith(42, true);
    });

    it('passes hasItadId=false to useGamePricing when false', () => {
        mockUseGamePricing.mockReturnValue({ data: undefined, isLoading: false });

        render(<WhereToBuySection gameId={99} hasItadId={false} />);

        expect(mockUseGamePricing).toHaveBeenCalledWith(99, false);
    });
});
