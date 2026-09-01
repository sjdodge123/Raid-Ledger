/**
 * ROK-1314 AC8 — `GameBadgeRow` behavioural coverage.
 *
 * The row is the ONE composed badge strip every game surface renders
 * (spec §5.1/§5.3). These tests pin:
 *   • personalized pills render ALONGSIDE the aggregates, never replacing them
 *     (spec §5.1, edge case §7.3);
 *   • the four personalization states — you-own only, aggregate only, both
 *     personalized, neither;
 *   • the `compact` variant's exclusions (spec §5.3 table).
 *
 * The row takes a normalized `GameBadgeData` view-model, NOT a raw DTO, so the
 * fixtures are built through the spec-named adapter `fromCommonGroundGame`
 * (spec §5.3). That keeps this test coupled to the two things the spec fixes —
 * the adapter names and the rendered copy — and not to the internal shape of
 * the view-model, which the spec deliberately leaves to the implementer.
 *
 * TDD: `game-badges` / `game-badges.helpers` do not exist yet, so this file
 * fails at import. That is the intended pre-implementation failure.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CommonGroundGameDto } from '@raid-ledger/contract';
import { GameBadgeRow } from './game-badges';
import { fromCommonGroundGame } from './game-badges.helpers';

/**
 * Baseline: nobody owns it, nobody wishlisted it, no discount, no metadata.
 * Every test opts INTO the signal it is asserting on.
 */
function buildGame(
    overrides: Partial<CommonGroundGameDto> = {},
): CommonGroundGameDto {
    return {
        gameId: 42,
        gameName: 'Valheim',
        slug: 'valheim',
        coverUrl: null,
        ownerCount: 0,
        wishlistCount: 0,
        nonOwnerPrice: null,
        itadCurrentCut: null,
        itadCurrentShop: null,
        itadCurrentUrl: null,
        itadLowestPrice: null,
        earlyAccess: false,
        itadTags: [],
        playerCount: null,
        score: 0,
        currentUserOwns: false,
        currentUserWishlisted: false,
        ...overrides,
    } as CommonGroundGameDto;
}

function renderRow(
    overrides: Partial<CommonGroundGameDto> = {},
    variant: 'compact' | 'full' = 'full',
) {
    return render(
        <GameBadgeRow game={fromCommonGroundGame(buildGame(overrides))} variant={variant} />,
    );
}

// ---------------------------------------------------------------------------
// AC8 state 1 — you-own only
// ---------------------------------------------------------------------------

describe('GameBadgeRow — you-own only', () => {
    it('renders "You own" alongside the owner aggregate, never instead of it', () => {
        renderRow({ ownerCount: 1, currentUserOwns: true });
        expect(screen.getByText('You own')).toBeInTheDocument();
        // Edge case §7.3: ownerCount === 1 still renders "1 own".
        expect(screen.getByText('1 own')).toBeInTheDocument();
    });

    it('does not render any wishlist personalization', () => {
        renderRow({ ownerCount: 3, currentUserOwns: true });
        expect(screen.queryByText('You wishlisted')).not.toBeInTheDocument();
    });

    it('renders both aggregate and personalized pills when others own it too', () => {
        renderRow({ ownerCount: 3, currentUserOwns: true });
        expect(screen.getByText('You own')).toBeInTheDocument();
        expect(screen.getByText('3 own')).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// AC8 state 2 — aggregate only (viewer owns nothing)
// ---------------------------------------------------------------------------

describe('GameBadgeRow — aggregate only', () => {
    it('renders the owner and wishlist counts with no personalization', () => {
        renderRow({ ownerCount: 5, wishlistCount: 2 });
        expect(screen.getByText('5 own')).toBeInTheDocument();
        expect(screen.getByText('2 wishlisted')).toBeInTheDocument();
        expect(screen.queryByText('You own')).not.toBeInTheDocument();
        expect(screen.queryByText('You wishlisted')).not.toBeInTheDocument();
    });

    it('renders "0 own" when nobody owns it (spec §6 empty state)', () => {
        renderRow({ ownerCount: 0 });
        expect(screen.getByText('0 own')).toBeInTheDocument();
    });

    it('renders no wishlist badge when wishlistCount is 0', () => {
        renderRow({ ownerCount: 4, wishlistCount: 0 });
        expect(screen.queryByText(/wishlisted/)).not.toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// AC8 state 3 — both personalized (edge case §7.2)
// ---------------------------------------------------------------------------

describe('GameBadgeRow — owned and wishlisted by the viewer', () => {
    it('renders both personalized pills and both aggregates', () => {
        renderRow({
            ownerCount: 3,
            wishlistCount: 2,
            currentUserOwns: true,
            currentUserWishlisted: true,
        });
        expect(screen.getByText('You own')).toBeInTheDocument();
        expect(screen.getByText('3 own')).toBeInTheDocument();
        expect(screen.getByText('You wishlisted')).toBeInTheDocument();
        expect(screen.getByText('2 wishlisted')).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// AC8 state 4 — neither (also the unauthenticated shape, spec §6/AC4)
// ---------------------------------------------------------------------------

describe('GameBadgeRow — no personalization', () => {
    it('renders no personalized pills when both flags are false', () => {
        renderRow({ ownerCount: 7, wishlistCount: 4 });
        expect(screen.queryByText('You own')).not.toBeInTheDocument();
        expect(screen.queryByText('You wishlisted')).not.toBeInTheDocument();
    });

    it('renders no personalized pills when the fields are absent entirely (stale client, edge case §7.4)', () => {
        const stale = buildGame({ ownerCount: 7, wishlistCount: 4 });
        delete (stale as Partial<CommonGroundGameDto>).currentUserOwns;
        delete (stale as Partial<CommonGroundGameDto>).currentUserWishlisted;
        render(<GameBadgeRow game={fromCommonGroundGame(stale)} variant="full" />);
        expect(screen.queryByText('You own')).not.toBeInTheDocument();
        expect(screen.queryByText('You wishlisted')).not.toBeInTheDocument();
        // The aggregates still render — personalization degrades, data does not.
        expect(screen.getByText('7 own')).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// AC8 state 5 — compact variant exclusions (spec §5.3 table)
// ---------------------------------------------------------------------------

describe('GameBadgeRow — compact variant', () => {
    /** Everything switched on, so each exclusion below is a real exclusion. */
    const LOADED: Partial<CommonGroundGameDto> = {
        ownerCount: 3,
        wishlistCount: 2,
        currentUserOwns: true,
        currentUserWishlisted: true,
        nonOwnerPrice: 19.99,
        itadCurrentCut: 40,
        itadLowestPrice: 9.99,
        playerCount: { min: 1, max: 4 },
        earlyAccess: true,
        cooptimusOnlineMax: 4,
    };

    it('includes YouOwnBadge, OwnerBadge, YouWishlistedBadge and the price badge', () => {
        renderRow(LOADED, 'compact');
        expect(screen.getByText('You own')).toBeInTheDocument();
        expect(screen.getByText('3 own')).toBeInTheDocument();
        expect(screen.getByText('You wishlisted')).toBeInTheDocument();
        expect(screen.getByText(/On Sale/)).toBeInTheDocument();
    });

    it('excludes the wishlist aggregate', () => {
        renderRow(LOADED, 'compact');
        expect(screen.queryByText('2 wishlisted')).not.toBeInTheDocument();
    });

    it('excludes the player-count badge', () => {
        renderRow(LOADED, 'compact');
        expect(screen.queryByText(/player/i)).not.toBeInTheDocument();
    });

    it('excludes the early-access badge', () => {
        renderRow(LOADED, 'compact');
        expect(screen.queryByText('Early Access')).not.toBeInTheDocument();
    });

    it('excludes the co-op pill', () => {
        const { container } = renderRow(LOADED, 'compact');
        expect(container.querySelector('[data-testid="coop-pill"]')).toBeNull();
    });

    it('the full variant DOES render everything compact excludes', () => {
        const { container } = renderRow(LOADED, 'full');
        expect(screen.getByText('2 wishlisted')).toBeInTheDocument();
        expect(screen.getByText('1-4 players')).toBeInTheDocument();
        expect(screen.getByText('Early Access')).toBeInTheDocument();
        expect(container.querySelector('[data-testid="coop-pill"]')).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Price vocabulary lock (spec §0) — the row never invents a third wording
// ---------------------------------------------------------------------------

describe('GameBadgeRow — price vocabulary', () => {
    it('renders "Best Price" when the current price is at or below the historical low', () => {
        renderRow({ nonOwnerPrice: 9.99, itadCurrentCut: 60, itadLowestPrice: 9.99 });
        expect(screen.getByText(/Best Price/)).toBeInTheDocument();
        expect(screen.queryByText(/On Sale/)).not.toBeInTheDocument();
    });

    it('renders "On Sale" when discounted but above the historical low', () => {
        renderRow({ nonOwnerPrice: 19.99, itadCurrentCut: 40, itadLowestPrice: 9.99 });
        expect(screen.getByText(/On Sale/)).toBeInTheDocument();
        expect(screen.queryByText(/Best Price/)).not.toBeInTheDocument();
    });

    it('renders "On Sale" (never "Best Price") when itadLowestPrice is absent (edge case §7.5)', () => {
        renderRow({ nonOwnerPrice: 19.99, itadCurrentCut: 40, itadLowestPrice: null });
        expect(screen.getByText(/On Sale/)).toBeInTheDocument();
        expect(screen.queryByText(/Best Price/)).not.toBeInTheDocument();
    });

    it('appends the price figure to the sale label (spec §5.2 showPrice)', () => {
        renderRow({ nonOwnerPrice: 19.99, itadCurrentCut: 40, itadLowestPrice: 9.99 });
        expect(screen.getByText(/On Sale.*\$19\.99/)).toBeInTheDocument();
    });

    it('renders a neutral price tag (not a sale badge) when there is no discount (spec §5.2)', () => {
        renderRow({ nonOwnerPrice: 29.99, itadCurrentCut: 0 });
        expect(screen.getByText(/\$29\.99/)).toBeInTheDocument();
        expect(screen.queryByText(/On Sale/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Best Price/)).not.toBeInTheDocument();
    });

    it('renders no price element when there is neither a price nor a discount', () => {
        renderRow({ nonOwnerPrice: null, itadCurrentCut: null });
        expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// PlayerBadge singular-awareness — CommonGround's behaviour wins over the
// GameInfoBadges drift (spec §1.4)
// ---------------------------------------------------------------------------

describe('GameBadgeRow — player count', () => {
    it('renders a range with the plural noun', () => {
        renderRow({ playerCount: { min: 1, max: 4 } });
        expect(screen.getByText('1-4 players')).toBeInTheDocument();
    });

    it('renders the singular noun for a single-player game', () => {
        renderRow({ playerCount: { min: 1, max: 1 } });
        expect(screen.getByText('1 player')).toBeInTheDocument();
    });

    it('renders nothing when playerCount is null (spec §6)', () => {
        renderRow({ playerCount: null });
        expect(screen.queryByText(/player/i)).not.toBeInTheDocument();
    });
});
