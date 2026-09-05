/**
 * ROK-1478 operator walk — the detail page's LFG affordance is a BANNER.
 *
 * The walk finding, verbatim: "it's not obvious you can click that, and it's
 * hard to click on mobile — it should be a banner." `GameBanner.tsx:95` sat an
 * `LfgChip` in the meta row beside the rating and genre pills, so the one
 * interactive element on that row looked exactly like the four static ones
 * next to it, and its tap target was a ~20px-tall `px-2 py-0.5` pill.
 *
 * TDD: `./game-detail-lfg-banner` does not exist yet, so this file fails at
 * import. That is the intended pre-implementation failure.
 *
 * Contract pinned here:
 *   • props mirror `LfgChipProps` — `{ activeCount, viabilityThreshold,
 *     state, gameSlug }` — so the swap at the call site is mechanical;
 *   • ONE element carries `data-testid="game-detail-lfg-banner"` and
 *     `data-lfg-state`, both carried over from the chip;
 *   • the sentence is `groupLine` from `lfg-chip-copy.ts` (ROK-1478 D4), so
 *     the banner, the card badge and the events banner cannot drift apart
 *     about the same group — asserted against the helper's own output, not
 *     against a second hardcoded copy of it;
 *   • it is an `<a href="/lfg/{slug}">`, so middle-click and copy-link work;
 *   • the same zero gate as the chip: nobody looking, nothing rendered.
 *
 * The `min-h-[44px]` assertion is a DELIBERATE exception to TESTING.md
 * anti-pattern #3 (no CSS assertions): "hard to click on mobile" IS the
 * finding, 44px is the WCAG 2.5.5 / iOS HIG target floor, and jsdom computes
 * no layout — so the class is the only observable form the fix has.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '../../test/render-helpers';
import { groupLine } from '../../components/lfg/lfg-chip-copy';
import { GameDetailLfgBanner } from './game-detail-lfg-banner';

const SLUG = 'deep-rock-galactic';

function renderBanner(props: {
    activeCount?: number | null;
    viabilityThreshold?: number | null;
    state?: 'lfg' | 'lfm' | null;
}) {
    return renderWithProviders(
        <GameDetailLfgBanner gameSlug={SLUG} {...props} />,
    );
}

describe('GameDetailLfgBanner', () => {
    it('reads the group line the card badge uses, with a Join call to action', () => {
        renderBanner({ activeCount: 2, state: 'lfm' });

        const banner = screen.getByTestId('game-detail-lfg-banner');
        // Derived from the shared helper, never a second copy of the prose:
        // if `groupLine` changes, this follows it and a drifting banner fails.
        expect(banner).toHaveTextContent(
            `🎯 ${groupLine(2, 'lfm')} — Join →`,
        );
    });

    it('renders the recruiting sentence, including the shortfall', () => {
        renderBanner({ activeCount: 1, state: 'lfg', viabilityThreshold: 4 });

        expect(screen.getByTestId('game-detail-lfg-banner')).toHaveTextContent(
            `🎯 ${groupLine(1, 'lfg', 4)} — Join →`,
        );
        // Guards the derivation above against a vacuous pass: the helper's
        // output for this group really does name the shortfall.
        expect(screen.getByTestId('game-detail-lfg-banner')).toHaveTextContent(
            'needs 3 more',
        );
    });

    it('links to the game group page', () => {
        renderBanner({ activeCount: 2, state: 'lfm' });

        expect(screen.getByTestId('game-detail-lfg-banner')).toHaveAttribute(
            'href',
            `/lfg/${SLUG}`,
        );
    });

    it('carries the effective LFG state, deriving it when the server sends none', () => {
        renderBanner({ activeCount: 3 });

        expect(screen.getByTestId('game-detail-lfg-banner')).toHaveAttribute(
            'data-lfg-state',
            'lfm',
        );
    });

    it('is a tap target at least 44px tall (the walk finding)', () => {
        renderBanner({ activeCount: 2, state: 'lfm' });

        expect(
            screen.getByTestId('game-detail-lfg-banner').className,
        ).toContain('min-h-[44px]');
    });

    it.each([
        ['zero', 0],
        ['null', null],
        ['undefined', undefined],
    ])('renders nothing when the active count is %s', (_label, activeCount) => {
        renderBanner({ activeCount });

        expect(screen.queryByTestId('game-detail-lfg-banner')).toBeNull();
    });

    it('has no accessibility violations', async () => {
        const { container } = renderBanner({ activeCount: 2, state: 'lfm' });

        expect(await axe(container)).toHaveNoViolations();
    });
});
