/**
 * Unit tests for the shared co-op pill (ROK-1401).
 *
 * The rule under test is the strict Co-Optimus-only one: only a finite
 * POSITIVE `cooptimus_online_max` produces a pill. A synced `0` ("asked, no
 * online co-op"), a never-synced `null`, and an `undefined` from a stale
 * cached row all render NOTHING — no element with the `coop-pill` testid, so
 * a pre-activation pill row is unchanged. IGDB `playerCount` is never a
 * fallback anywhere in this component.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoopPill } from './CoopPill';

const PILL = 'coop-pill';

describe('CoopPill — renders for a positive Co-Optimus value', () => {
    // ROK-1401 round 3: copy is one of three shared labels, count first.
    it('renders "👥 N online co-op" with the raw cap', () => {
        render(<CoopPill cooptimusOnlineMax={4} />);
        expect(screen.getByTestId(PILL)).toHaveTextContent('👥 4 online co-op');
    });

    it('renders a solo-capable co-op value', () => {
        render(<CoopPill cooptimusOnlineMax={1} />);
        expect(screen.getByTestId(PILL)).toHaveTextContent('👥 1 online co-op');
    });

    it('renders a large cap verbatim without clamping', () => {
        render(<CoopPill cooptimusOnlineMax={32} />);
        expect(screen.getByTestId(PILL)).toHaveTextContent(
            '👥 32 online co-op',
        );
    });

    it('renders "local co-op" for a couch-only game', () => {
        render(<CoopPill cooptimusOnlineMax={0} cooptimusCouchMax={2} />);
        const pill = screen.getByTestId(PILL);
        expect(pill).toHaveTextContent('👥 2 local co-op');
        expect(pill.textContent).not.toMatch(/online/i);
    });

    it('renders "combo co-op" when Co-Optimus flags Local + Online', () => {
        render(
            <CoopPill
                cooptimusOnlineMax={4}
                cooptimusCouchMax={2}
                cooptimusComboCoop
            />,
        );
        expect(screen.getByTestId(PILL)).toHaveTextContent(
            '👥 4 combo co-op',
        );
    });

    it('stays "online co-op" when both counts exist but the combo flag does not', () => {
        render(<CoopPill cooptimusOnlineMax={4} cooptimusCouchMax={2} />);
        expect(screen.getByTestId(PILL)).toHaveTextContent(
            '👥 4 online co-op',
        );
    });

    it('gives the pill an accessible name naming co-op and online play', () => {
        render(<CoopPill cooptimusOnlineMax={4} />);
        expect(
            screen.getByRole('img', { name: /co-op: up to 4 players online/i }),
        ).toBeInTheDocument();
    });

    it('merges caller positioning classes onto the pill', () => {
        render(<CoopPill cooptimusOnlineMax={4} className="mt-0.5" />);
        expect(screen.getByTestId(PILL).className).toContain('mt-0.5');
    });
});

describe('CoopPill — renders NO element when unverified', () => {
    /**
     * Positive control first, then the absent variant: a bare
     * `queryByTestId(...).toBeNull()` would also pass if the component were
     * deleted outright, so each negative is paired with a render that DOES
     * produce the pill.
     */
    function expectNothingRendered(value: number | null | undefined) {
        const control = render(<CoopPill cooptimusOnlineMax={6} />);
        expect(screen.getByTestId(PILL)).toBeInTheDocument();
        control.unmount();

        const { container } = render(<CoopPill cooptimusOnlineMax={value} />);
        expect(screen.queryByTestId(PILL)).toBeNull();
        // No placeholder, no wrapper, no reserved space.
        expect(container.firstChild).toBeNull();
    }

    it('renders nothing for a synced ZERO (no online co-op)', () => {
        expectNothingRendered(0);
    });

    it('renders nothing for a lone couch seat (couch 1 is not local co-op)', () => {
        const control = render(<CoopPill cooptimusOnlineMax={6} />);
        expect(screen.getByTestId(PILL)).toBeInTheDocument();
        control.unmount();

        const { container } = render(
            <CoopPill cooptimusOnlineMax={0} cooptimusCouchMax={1} />,
        );
        expect(screen.queryByTestId(PILL)).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing for null (never synced)', () => {
        expectNothingRendered(null);
    });

    it('renders nothing for undefined (stale cached row missing the field)', () => {
        expectNothingRendered(undefined);
    });

    it('renders nothing for a negative value (defensive)', () => {
        expectNothingRendered(-1);
    });

    it('renders nothing for NaN (defensive)', () => {
        expectNothingRendered(Number.NaN);
    });

    it('renders nothing for Infinity (defensive)', () => {
        expectNothingRendered(Number.POSITIVE_INFINITY);
    });
});
