/**
 * ROK-1573/1572/1571 — the LFG hero: badge / headline / sub per state, and the
 * ONE primary under the card (poll, or Open the event once locked in).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LfgConvertedEventDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockLfgGroupDetail } from '../../test/lfg-factories';
import { LfgHero, type LfgHeroProps } from './LfgHero';

const EVENT: LfgConvertedEventDto = {
    eventId: 91,
    title: 'Valheim',
    startTime: '2026-09-23T20:00:00',
    signupCount: 3,
};

function renderHero(overrides: Partial<LfgHeroProps> = {}) {
    const props: LfgHeroProps = {
        group: createMockLfgGroupDetail({
            activeCount: 4,
            nowCount: 2,
            isViable: false,
            viabilityThreshold: 5,
        }),
        convertedEvent: null,
        participants: <span data-testid="chip">chip</span>,
        onStartPoll: vi.fn(),
        onStartNow: vi.fn(),
        ...overrides,
    };
    renderWithProviders(<LfgHero {...props} />);
    return props;
}

describe('LfgHero', () => {
    it('reads a short group as LOOKING FOR MEMBERS with the gap', () => {
        renderHero();

        expect(screen.getByText('LOOKING FOR MEMBERS')).toBeInTheDocument();
        expect(screen.getByText('4 looking · 2 want to play now')).toBeInTheDocument();
        expect(screen.getByText('Needs 1 more for a full group')).toBeInTheDocument();
        expect(screen.getByTestId('chip')).toBeInTheDocument();
    });

    it('reads a viable group as FULL GROUP without a gap line', () => {
        renderHero({
            group: createMockLfgGroupDetail({
                activeCount: 5,
                nowCount: 0,
                isViable: true,
                viabilityThreshold: 5,
            }),
        });

        expect(screen.getByText('FULL GROUP')).toBeInTheDocument();
        expect(screen.getByText('5 looking')).toBeInTheDocument();
        expect(screen.queryByText(/Needs \d+ more/)).toBeNull();
    });

    it('offers the scheduling poll primary with its note', async () => {
        const props = renderHero();

        const primary = screen.getByTestId('lfg-hero-primary');
        expect(primary).toHaveTextContent('Start a scheduling poll');
        expect(screen.getByTestId('lfg-start-poll-hint')).toHaveTextContent(
            'Everyone looking gets a Discord card and a vote on times.',
        );
        await userEvent.click(primary);
        expect(props.onStartPoll).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('lfg-converted-event')).toBeNull();
    });

    it('disables the poll and shows the hint when the viewer has no intent', async () => {
        const props = renderHero({ primaryDisabledHint: '+1 first' });

        const primary = screen.getByTestId('lfg-hero-primary');
        expect(primary).toBeDisabled();
        expect(screen.getByTestId('lfg-start-poll-hint')).toHaveTextContent('+1 first');
        await userEvent.click(primary);
        expect(props.onStartPoll).not.toHaveBeenCalled();
    });

    /**
     * ROK-1613 AC1. The three participation SHAPES are not asserted here:
     * `PollRow` never receives `group`, so an empty group and two now-hands
     * render identically and an `it.each` over them would prove nothing. The
     * shape coverage lives in `lfg-group-top.test.tsx`, which owns the state
     * that actually decides which row renders.
     */
    describe('ROK-1613 — the start-now action (AC1)', () => {
        it('sits beside the poll primary while the group is looking', () => {
            renderHero();

            const startNow = screen.getByTestId('lfg-hero-start-now');
            expect(startNow).toBeInTheDocument();
            expect(startNow).toHaveTextContent('Start playing now');
            expect(startNow).toBeEnabled();
        });

        it('calls onStartNow rather than onStartPoll', async () => {
            const props = renderHero();

            await userEvent.click(screen.getByTestId('lfg-hero-start-now'));

            expect(props.onStartNow).toHaveBeenCalledTimes(1);
            expect(props.onStartPoll).not.toHaveBeenCalled();
        });

        it('is disabled by the same needs-intent hint that gates the poll (AC6)', async () => {
            const props = renderHero({ primaryDisabledHint: '+1 first' });

            const startNow = screen.getByTestId('lfg-hero-start-now');
            expect(startNow).toBeDisabled();
            await userEvent.click(startNow);
            expect(props.onStartNow).not.toHaveBeenCalled();
        });

        /**
         * The regression the reviewer found: a locked-in group is waiting on a
         * FUTURE event, not playing, so AC5 does not sanction hiding the
         * button. Before the fix `OpenEventRow` replaced the whole action row.
         */
        it('SURVIVES the locked-in state, beside Open the event', async () => {
            const props = renderHero({ convertedEvent: EVENT });

            const startNow = screen.getByTestId('lfg-hero-start-now');
            expect(startNow).toBeInTheDocument();
            expect(screen.getByTestId('lfg-hero-primary')).toHaveTextContent('Open the event');
            await userEvent.click(startNow);
            expect(props.onStartNow).toHaveBeenCalledTimes(1);
        });

        it('carries the refusal into the locked-in state too', () => {
            renderHero({ convertedEvent: EVENT, primaryDisabledHint: '+1 first' });

            expect(screen.getByTestId('lfg-hero-start-now')).toBeDisabled();
            expect(screen.getByTestId('lfg-start-poll-hint')).toHaveTextContent('+1 first');
        });
    });
});
