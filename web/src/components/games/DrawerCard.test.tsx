/**
 * Unit + regression tests for DrawerCard (ROK-1295 card; ROK-1342 fixes;
 * ROK-1525 clickable badges).
 *
 * DrawerCard is the Discover-tab card — `GameCarousel` selects it via
 * `clickMode="drawer"` for BOTH the desktop carousel and the mobile row — a
 * single tappable button that opens the GameResearchDrawer. The drawer itself
 * only navigates (needs Router + query providers), so it is stubbed down to a
 * marker that renders iff `isOpen`: that keeps the original overlay-layout
 * assertions intact while letting the ROK-1525 cases prove a badge click does
 * NOT open it.
 */
import type { JSX } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '../../test/render-helpers';
import { DrawerCard } from './DrawerCard';
import { PlayerBadge, OwnerBadge } from './game-badges';
import { render } from '@testing-library/react';
import type { GameDetailDto, ItadGamePricingDto } from '@raid-ledger/contract';

vi.mock('./GameResearchDrawer', () => ({
    GameResearchDrawer: ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="research-drawer" /> : null,
}));

/** Prints the live query string so a badge click's URL write is assertable. */
function LocationProbe(): JSX.Element {
    const { search } = useLocation();
    return <output data-testid="location-search">{search}</output>;
}

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

/** Render the card inside a router, with the query string on screen. */
function renderCard(game: GameDetailDto, pricing: ItadGamePricingDto | null = null) {
    return renderWithProviders(
        <>
            <DrawerCard game={game} pricing={pricing} />
            <LocationProbe />
        </>,
    );
}

const search = (): string => screen.getByTestId('location-search').textContent ?? '';

describe('DrawerCard', () => {
    it('renders as a single tappable research button', () => {
        renderCard(createGame());
        const btn = screen.getByTestId('game-ref-row');
        expect(btn).toBeInTheDocument();
        expect(btn).toHaveAttribute('aria-label', 'Research Elden Ring');
    });

    it('renders the rating badge and On Sale badge together when pricing is present', () => {
        renderCard(createGame(), createOnSalePricing());
        expect(screen.getByLabelText('Rating 95')).toBeInTheDocument();
        expect(screen.getByText('On Sale')).toBeInTheDocument();
    });
});

describe('Regression: ROK-1342 — badge placement + no (i) marker', () => {
    it('does not stack the On Sale badge in the same corner as the rating badge', () => {
        renderCard(createGame(), createOnSalePricing());

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
        const { container } = renderCard(createGame(), createOnSalePricing());

        // The old marker was an aria-hidden span titled "Open game details".
        expect(
            container.querySelector('[title="Open game details"]'),
        ).toBeNull();
        expect(
            container.querySelector('span[aria-hidden="true"][title="Open game details"]'),
        ).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// ROK-1525 — the card's badges are the filter affordance
//
// Operator ask: "use badged content as clickable elements as well". The strip
// the badges live in is hoisted OUT of the card's root `<button>` and rendered
// as its SIBLING — the `CardLfgChip` precedent
// (`unified-game-card-parts.tsx:111-142`) — because an activatable element
// nested inside a button is an invalid content model. `button button` is the
// structural guard, the sibling of `lfg-chip.test.tsx`'s `a a`.
//
// Only the Discover card surface changes here. `UnifiedGameCard` (which also
// hosts the Discover-tab SEARCH results), `CommonGroundGameCard`,
// `NominationCard`, the veto cards and game-detail are deliberately untouched —
// ROK-1129 unifies those, and doing it now means doing it twice.
// ---------------------------------------------------------------------------

describe('ROK-1525 — clickable Discover-card badges', () => {
    it('clicking the player-count badge applies the nearest preset without opening the drawer', () => {
        renderCard(createGame({ playerCount: { min: 1, max: 4 } } as Partial<GameDetailDto>));

        fireEvent.click(screen.getByText('1-4 players'));

        // `1-4` seats the 4-player party — the largest preset in the range.
        expect(search()).toBe('?players=4');
        expect(screen.queryByTestId('research-drawer')).toBeNull();
    });

    it('clicking the owner-count badge applies owners>=N without opening the drawer', () => {
        renderCard(createGame({ ownerCount: 4 } as Partial<GameDetailDto>));

        fireEvent.click(screen.getByText('4 own'));

        expect(search()).toBe('?owners=4');
        expect(screen.queryByTestId('research-drawer')).toBeNull();
    });

    it('still opens the research drawer when the card itself is clicked', () => {
        renderCard(
            createGame({ playerCount: { min: 1, max: 4 }, ownerCount: 4 } as Partial<GameDetailDto>),
        );

        fireEvent.click(screen.getByTestId('game-ref-row'));

        expect(screen.getByTestId('research-drawer')).toBeInTheDocument();
        // The card's own click target must not double as a filter write.
        expect(search()).toBe('');
    });

    it('nests no interactive element inside the card root button', () => {
        const { container } = renderCard(
            createGame({
                playerCount: { min: 1, max: 4 },
                ownerCount: 4,
                currentUserOwns: true,
            } as Partial<GameDetailDto>),
            createOnSalePricing(),
        );

        expect(container.querySelector('button button')).toBeNull();
        expect(container.querySelector('button a')).toBeNull();
        // ...and the activatable strip really is outside the root button.
        const root = screen.getByTestId('game-ref-row');
        expect(within(root).queryByText('1-4 players')).toBeNull();
        expect(screen.getByText('1-4 players')).toBeInTheDocument();
    });

    it('leaves a badge with no nearest preset inert rather than writing a bogus param', () => {
        // `1 player` straddles no preset (2/3/4/5+ all need max >= 2), so the
        // badge must stay a plain span rather than write `?players=`.
        renderCard(createGame({ playerCount: { min: 1, max: 1 } } as Partial<GameDetailDto>));

        const badge = screen.getByText('1 player');
        expect(badge.tagName).toBe('SPAN');
        fireEvent.click(badge);
        expect(search()).toBe('');
    });
});

describe('ROK-1525 — badges are unchanged without an activation handler', () => {
    // The parity guard (`card-surface-parity.test.tsx`) and the dedup guard
    // (`game-badges.dedup-guard.test.ts`) both rest on the badge vocabulary
    // being identical across surfaces. The activation prop is therefore purely
    // additive: with no handler the markup must be byte-for-byte what every
    // other surface has always rendered.
    it('PlayerBadge renders the same span it always did', () => {
        const { container } = render(<PlayerBadge playerCount={{ min: 1, max: 4 }} />);
        expect(container.innerHTML).toBe(
            '<span class="px-2 py-0.5 text-xs font-bold rounded bg-violet-500/90 text-white">1-4 players</span>',
        );
    });

    it('OwnerBadge renders the same span it always did', () => {
        const { container } = render(<OwnerBadge count={4} />);
        expect(container.innerHTML).toBe(
            '<span class="px-2 py-0.5 text-xs font-bold rounded bg-emerald-500/90 text-white">4 own</span>',
        );
    });
});
