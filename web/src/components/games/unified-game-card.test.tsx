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

    it('has aria-label with game name on the link element', () => {
        renderCard(
            <UnifiedGameCard variant="link" game={createBaseGame()} />,
        );
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('aria-label', 'Elden Ring');
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

    it('has aria-label reflecting selection state', () => {
        const { rerender } = renderCard(
            <UnifiedGameCard
                variant="toggle"
                game={createBaseGame()}
                selected={false}
                onToggle={vi.fn()}
            />,
        );
        expect(screen.getByRole('button')).toHaveAttribute(
            'aria-label',
            'Select Elden Ring',
        );

        rerender(
            <MemoryRouter>
                <UnifiedGameCard
                    variant="toggle"
                    game={createBaseGame()}
                    selected={true}
                    onToggle={vi.fn()}
                />
            </MemoryRouter>,
        );
        expect(screen.getByRole('button')).toHaveAttribute(
            'aria-label',
            'Deselect Elden Ring',
        );
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

// ── Co-Optimus co-op badge (ROK-1399) ────────────────────────────────────────
//
// Proves the two numeric fields are threaded from the DTO through GameProps
// into the InfoBar badge. Badge behaviour itself is covered in
// game-card-parts.test.tsx. Spec: planning-artifacts/specs/ROK-1399.md.

/**
 * ROK-1314: co-op moved OFF the InfoBar and onto the shared `CoopPill` in
 * `GameBadgeRow` (operator decision 2026-09-01) — `/games` previously used a
 * local `CoopBadge` while Common Ground used the pill, two components for one
 * idea. These assertions are UNCHANGED in substance: the card must still show
 * co-op, with the same three labels and the same aria-label, because both
 * components render from the shared `coopLabel` helper. Only the testid moves.
 */
const COOP_BADGE = 'coop-pill';

describe('UnifiedGameCard — co-op pill (ROK-1399, moved to GameBadgeRow in ROK-1314)', () => {
    it('threads cooptimusOnlineMax through GameProps into the co-op pill', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame({
                    cooptimusOnlineMax: 4,
                    cooptimusCouchMax: null,
                })}
            />,
        );
        const badge = screen.getByTestId(COOP_BADGE);
        // ROK-1401 round 3: one of three labels, count first.
        expect(badge).toHaveTextContent('👥 4 online co-op');
    });

    it('threads a couch-only game through as a local badge', () => {
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame({
                    cooptimusOnlineMax: 0,
                    cooptimusCouchMax: 2,
                })}
            />,
        );
        expect(screen.getByTestId(COOP_BADGE)).toHaveTextContent(
            '👥 2 local co-op',
        );
    });

    it('threads the Co-Optimus combo flag through GameProps', () => {
        // ROK-1401: `cooptimusComboCoop` is additive on GameProps — a stale
        // cached row without it falls through to the online/local labels.
        renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame({
                    cooptimusOnlineMax: 4,
                    cooptimusCouchMax: 2,
                    cooptimusComboCoop: true,
                })}
            />,
        );
        expect(screen.getByTestId(COOP_BADGE)).toHaveTextContent(
            '👥 4 combo co-op',
        );
    });

    it('renders no badge for an unenriched game and keeps the card intact', () => {
        const { rerender } = renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame({
                    cooptimusOnlineMax: 4,
                    cooptimusCouchMax: 2,
                })}
            />,
        );
        expect(screen.getByTestId(COOP_BADGE)).toBeInTheDocument();

        rerender(
            <MemoryRouter>
                <UnifiedGameCard
                    variant="link"
                    game={createBaseGame({
                        cooptimusOnlineMax: null,
                        cooptimusCouchMax: null,
                    })}
                />
            </MemoryRouter>,
        );
        expect(screen.queryByTestId(COOP_BADGE)).not.toBeInTheDocument();
        expect(screen.getByText('Elden Ring')).toBeInTheDocument();
    });

    it('survives the stale-cache shape (fields absent entirely)', () => {
        // Redis-cached discover rows predating the SELECT change carry neither
        // field. No badge, no crash, no literal "undefined" in the DOM.
        const { container, rerender } = renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame({
                    cooptimusOnlineMax: 4,
                    cooptimusCouchMax: 2,
                })}
            />,
        );
        expect(screen.getByTestId(COOP_BADGE)).toBeInTheDocument();

        rerender(
            <MemoryRouter>
                <UnifiedGameCard
                    variant="link"
                    game={createBaseGame()}
                />
            </MemoryRouter>,
        );
        expect(screen.queryByTestId(COOP_BADGE)).not.toBeInTheDocument();
        expect(container.textContent).not.toMatch(/undefined|NaN/);
    });

    it('does not add a Co-Optimus attribution line to the card DOM', () => {
        // Operator decision: the credit lives on the game detail page
        // (ROK-1398's CoopFeaturesSection footer), never on the card.
        const { container, rerender } = renderCard(
            <UnifiedGameCard
                variant="link"
                game={createBaseGame({
                    cooptimusOnlineMax: 4,
                    cooptimusCouchMax: 2,
                })}
            />,
        );
        expect(screen.getByTestId(COOP_BADGE)).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/co-?optimus/i);

        rerender(
            <MemoryRouter>
                <UnifiedGameCard
                    variant="link"
                    game={createBaseGame({
                        cooptimusOnlineMax: 0,
                        cooptimusCouchMax: 4,
                    })}
                />
            </MemoryRouter>,
        );
        expect(container.textContent).not.toMatch(/co-?optimus/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROK-1401 — hover-zoom must not bleed into the InfoBar footer
//
// The cover is `absolute inset-0` and grows to `scale-105` on group hover.
// An absolutely-positioned child paints ABOVE its statically-positioned
// siblings, so if the cover wrapper does not clip, that extra ~2.5% lands on
// top of the footer as a bright full-width band (operator browser-review,
// 2026-08-21 — measured at 7.8px into a 36px footer, and `elementFromPoint`
// 4px below the cover returned the IMG instead of the footer).
//
// `overflow-hidden` on the wrapper is the fix. The card's OWN `overflow-hidden`
// does not help — it only clips at the outer card edge, well below the seam.
// jsdom computes no layout, so this pins the DOM invariant rather than pixels.
// ─────────────────────────────────────────────────────────────────────────────

describe('UnifiedGameCard — cover clipping (ROK-1401)', () => {
    function coverWrapper(container: HTMLElement): HTMLElement {
        const el = container.querySelector<HTMLElement>('.aspect-\\[3\\/4\\]');
        expect(el, 'card must render a cover wrapper').not.toBeNull();
        return el!;
    }

    it('clips the cover wrapper so the hover zoom cannot overlap the footer', () => {
        const { container } = renderCard(
            <UnifiedGameCard
                variant="link"
                showRating
                game={createBaseGame()}
            />,
        );
        const cover = coverWrapper(container);
        expect(cover.className).toContain('overflow-hidden');
        // The scaling element really is inside the clipped wrapper.
        expect(
            cover.querySelector('.group-hover\\:scale-105'),
        ).not.toBeNull();
    });

    it('clips the toggle variant too', () => {
        const { container } = renderCard(
            <UnifiedGameCard
                variant="toggle"
                selected={false}
                onToggle={vi.fn()}
                game={createBaseGame()}
            />,
        );
        expect(coverWrapper(container).className).toContain('overflow-hidden');
    });
});
