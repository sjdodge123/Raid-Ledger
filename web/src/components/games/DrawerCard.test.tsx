/**
 * Unit + regression tests for DrawerCard (ROK-1295 card; ROK-1342 fixes).
 *
 * DrawerCard is the mobile `/games` carousel card: a single tappable button
 * that opens the GameResearchDrawer. We mock the drawer (it only navigates /
 * needs router + query providers) so these tests focus purely on the card's
 * own overlay layout.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DrawerCard } from './DrawerCard';
import type { GameDetailDto, ItadGamePricingDto } from '@raid-ledger/contract';

// The drawer only navigates (needs Router + QueryClient). Stub it out — these
// tests assert on the card overlay, not the drawer.
vi.mock('./GameResearchDrawer', () => ({
    GameResearchDrawer: () => null,
}));

function createGame(overrides: Partial<GameDetailDto> = {}): GameDetailDto {
    return {
        id: 1,
        name: 'Elden Ring',
        coverUrl: 'https://example.com/cover.jpg',
        genres: [12],
        aggregatedRating: 95,
        rating: 92,
        ...overrides,
    } as GameDetailDto;
}

function createOnSalePricing(
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
    } as ItadGamePricingDto;
}

describe('DrawerCard', () => {
    it('renders as a single tappable research button', () => {
        render(<DrawerCard game={createGame()} pricing={null} />);
        const btn = screen.getByTestId('game-ref-row');
        expect(btn).toBeInTheDocument();
        expect(btn).toHaveAttribute('aria-label', 'Research Elden Ring');
    });

    it('renders the rating badge and On Sale badge together when pricing is present', () => {
        render(
            <DrawerCard game={createGame()} pricing={createOnSalePricing()} />,
        );
        expect(screen.getByLabelText('Rating 95')).toBeInTheDocument();
        expect(screen.getByText('On Sale')).toBeInTheDocument();
    });
});

describe('Regression: ROK-1342 — badge placement + no (i) marker', () => {
    it('does not stack the On Sale badge in the same corner as the rating badge', () => {
        render(
            <DrawerCard game={createGame()} pricing={createOnSalePricing()} />,
        );

        const ratingBadge = screen.getByLabelText('Rating 95');
        const priceWrapper = screen.getByText('On Sale').closest('div')!;

        // Rating sits top-RIGHT; the On Sale badge sits in the freed top-LEFT
        // corner (the (i) marker was removed). Same top edge, opposite
        // horizontal corners -> no overlap, and clear of the bottom title strip
        // (Codex P2: bottom-2 right-2 could clip a long 2-line title).
        expect(ratingBadge.className).toContain('top-2');
        expect(ratingBadge.className).toContain('right-2');

        expect(priceWrapper.className).toContain('top-2');
        expect(priceWrapper.className).toContain('left-2');
        expect(priceWrapper.className).not.toContain('right-2');

        // The two badges must not share identical positioning classes.
        expect(priceWrapper.className).not.toBe(ratingBadge.className);
    });

    it('no longer renders the redundant (i) visual marker', () => {
        const { container } = render(
            <DrawerCard game={createGame()} pricing={createOnSalePricing()} />,
        );

        // The old marker was an aria-hidden span titled "Open game details".
        expect(
            container.querySelector('[title="Open game details"]'),
        ).toBeNull();
        expect(
            container.querySelector('span[aria-hidden="true"][title="Open game details"]'),
        ).toBeNull();
    });
});
