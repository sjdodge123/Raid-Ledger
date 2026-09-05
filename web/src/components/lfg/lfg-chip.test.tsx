/**
 * ROK-1453 AC1/AC2/AC4 — the LFG tile chip.
 *
 * TDD: `./lfg-chip` does not exist yet, so this file fails at import. That is
 * the intended pre-implementation failure.
 *
 * Contract these tests pin (spec §Files → `lfg-chip.tsx`, decisions D4/D5/D9):
 *   • props `{ activeCount, viabilityThreshold, state, gameSlug }`;
 *   • ONE element carries `data-testid="lfg-chip"`, `role="link"`,
 *     `data-lfg-state` and the `aria-label`;
 *   • copy is the source of truth for the count (D9) — `🎯 N looking to play`
 *     for lfm, `🎯 1 looking · needs N more` for lfg;
 *   • `needs N more` = `max(1, (viabilityThreshold ?? 2) - activeCount)`;
 *   • activating the chip lands on `/lfg/{gameSlug}`;
 *   • the chip is NOT an anchor: `CardBadgeRow` renders inside the tile's
 *     `<Link>` (`unified-game-card.tsx:92`), and an `<a>` inside an `<a>` is
 *     invalid HTML (D5). A `<button role="link">` that navigates satisfies
 *     both placements; the smoke spec only asserts the resulting URL.
 *
 * Colour assertions (D4) are a DELIBERATE exception to TESTING.md
 * anti-pattern #3: AC2 specifies the amber-300 tonal token *because*
 * `bg-amber-500/90` is already double-booked by Wishlist and On Sale
 * (`game-badges.tsx:55`, `PriceBadge.tsx:12`). The token IS the acceptance
 * criterion here, so it is asserted once per state and nowhere else.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '../../test/render-helpers';
import { LfgChip } from './lfg-chip';

interface ChipProps {
    activeCount?: number;
    viabilityThreshold?: number | null;
    state?: 'lfg' | 'lfm' | null;
    gameSlug?: string;
}

function LocationProbe() {
    const location = useLocation();
    return <span data-testid="location-probe">{location.pathname}</span>;
}

function renderChip(props: ChipProps = {}) {
    const merged = {
        activeCount: 2,
        viabilityThreshold: null,
        state: 'lfm' as const,
        gameSlug: 'deep-rock-galactic',
        ...props,
    };
    return renderWithProviders(
        <>
            <LfgChip {...merged} />
            <LocationProbe />
        </>,
        { initialEntries: ['/games'] },
    );
}

/** Whitespace-normalized visible copy of the chip. */
function chipText(): string {
    return (
        screen.getByTestId('lfg-chip').textContent ?? ''
    )
        .replace(/\s+/g, ' ')
        .trim();
}

describe('LfgChip — absence (AC4)', () => {
    it('renders nothing when nobody is looking', () => {
        renderChip({ activeCount: 0, state: null });

        expect(screen.queryByTestId('lfg-chip')).not.toBeInTheDocument();
        // Never "0 looking" — the whole point of AC4.
        expect(screen.queryByText(/looking/i)).not.toBeInTheDocument();
    });

    it('renders nothing when the game is absent from GET /lfg', () => {
        // The provider returns `undefined` for a game with no group.
        renderChip({ activeCount: undefined, state: undefined });

        expect(screen.queryByTestId('lfg-chip')).not.toBeInTheDocument();
    });
});

describe('LfgChip — lfm, two or more looking (AC1)', () => {
    it('reads "N looking to play" and reports state=lfm', () => {
        renderChip({ activeCount: 2, state: 'lfm' });

        expect(chipText()).toBe('🎯 2 looking to play');
        expect(screen.getByTestId('lfg-chip')).toHaveAttribute(
            'data-lfg-state',
            'lfm',
        );
    });

    it('scales the count with the group (D9 — text, not an attribute)', () => {
        renderChip({ activeCount: 5, state: 'lfm' });

        expect(chipText()).toBe('🎯 5 looking to play');
    });

    it('uses the emerald solid token (D4)', () => {
        renderChip({ activeCount: 2, state: 'lfm' });

        expect(screen.getByTestId('lfg-chip').className).toContain(
            'bg-emerald-500/90',
        );
    });
});

describe('LfgChip — lfg, one looking (AC2)', () => {
    it('reads "1 looking · needs 1 more" with no Co-Optimus data', () => {
        renderChip({ activeCount: 1, state: 'lfg', viabilityThreshold: null });

        expect(chipText()).toBe('🎯 1 looking · needs 1 more');
        expect(screen.getByTestId('lfg-chip')).toHaveAttribute(
            'data-lfg-state',
            'lfg',
        );
    });

    it('derives "needs 3 more" from viabilityThreshold 4', () => {
        renderChip({ activeCount: 1, state: 'lfg', viabilityThreshold: 4 });

        expect(chipText()).toBe('🎯 1 looking · needs 3 more');
    });

    it('never asks for fewer than one more player', () => {
        // threshold already met at one player — clamp, don't render "needs 0".
        renderChip({ activeCount: 1, state: 'lfg', viabilityThreshold: 1 });

        expect(chipText()).toBe('🎯 1 looking · needs 1 more');
    });

    it('uses the amber-300 tonal token, not the double-booked amber-500 (D4)', () => {
        renderChip({ activeCount: 1, state: 'lfg' });

        const cls = screen.getByTestId('lfg-chip').className;
        expect(cls).toContain('bg-amber-300/95');
        expect(cls).not.toContain('bg-amber-500/90');
    });
});

describe('LfgChip — navigation and labelling (AC1)', () => {
    it('lands on /lfg/{gameSlug} when activated', async () => {
        const user = userEvent.setup();
        renderChip({ gameSlug: 'helldivers-2', activeCount: 2, state: 'lfm' });

        await user.click(screen.getByTestId('lfg-chip'));

        expect(screen.getByTestId('location-probe')).toHaveTextContent(
            '/lfg/helldivers-2',
        );
    });

    it('exposes the link role and an aria-label equal to the visible text', () => {
        renderChip({ activeCount: 1, state: 'lfg' });

        const chip = screen.getByTestId('lfg-chip');
        expect(chip).toHaveAttribute('role', 'link');
        expect(chip.getAttribute('aria-label')).toBe(chipText());
        // The accessible name is what a screen-reader user hears — it must be
        // the same sentence sighted users read.
        expect(screen.getByRole('link', { name: chipText() })).toBe(chip);
    });

    it('has no accessibility violations', async () => {
        const { container } = renderChip({ activeCount: 2, state: 'lfm' });

        expect(await axe(container)).toHaveNoViolations();
    });
});

describe('LfgChip — inside a tile link (D5)', () => {
    it('does not nest an anchor inside the tile anchor', () => {
        const onTileClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
        const { container } = renderWithProviders(
            <a href="/games/1" onClick={onTileClick}>
                <span>Deep Rock Galactic</span>
                <LfgChip
                    activeCount={2}
                    state="lfm"
                    viabilityThreshold={null}
                    gameSlug="deep-rock-galactic"
                />
            </a>,
            { initialEntries: ['/games'] },
        );

        expect(screen.getByTestId('lfg-chip')).toBeInTheDocument();
        expect(container.querySelector('a a')).toBeNull();
    });

    it('stops the click from reaching the tile link', async () => {
        const user = userEvent.setup();
        const onTileClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
        renderWithProviders(
            <>
                <a href="/games/1" onClick={onTileClick}>
                    <span>Deep Rock Galactic</span>
                    <LfgChip
                        activeCount={2}
                        state="lfm"
                        viabilityThreshold={null}
                        gameSlug="deep-rock-galactic"
                    />
                </a>
                <LocationProbe />
            </>,
            { initialEntries: ['/games'] },
        );

        await user.click(screen.getByTestId('lfg-chip'));

        expect(onTileClick).not.toHaveBeenCalled();
        expect(screen.getByTestId('location-probe')).toHaveTextContent(
            '/lfg/deep-rock-galactic',
        );
    });
});
