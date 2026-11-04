import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { createMockEvent } from '../../../test/factories';
import { SeriesMemberActions } from './SeriesMemberActions';
import { activeMembership, night, seriesState } from './series-signup.test-helpers';

const env = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: vi.fn(() => true) }));
vi.mock('../../../hooks/use-series-signup', () => ({ useLeaveSeries: vi.fn(() => ({ mutate: env.mutate, isPending: false })) }));

const event = createMockEvent({ id: 10, title: 'Weekly Raid Night', recurrenceGroupId: '22222222-2222-4222-8222-222222222222' });

function renderActions(firstNightHours: number, onSkip = vi.fn()) {
    const state = seriesState([night(10, firstNightHours, 'in_series', 'signed_up'), night(11, firstNightHours + 168, 'in_series', 'signed_up')],
        { membership: activeMembership() });
    renderWithProviders(
        <SeriesMemberActions event={event} state={state} statusToggle={<button type="button">Tentative</button>} onSkip={onSkip} isSkipping={false} />,
    );
    return { onSkip };
}

const state10 = () => new Date(Date.now() + 168 * 3600_000).toISOString();
const state11 = () => new Date(Date.now() + 336 * 3600_000).toISOString();

describe('SeriesMemberActions', () => {
    beforeEach(() => { env.mutate = vi.fn(); });

    it('renders In for the series with Tentative, Skip this night and Leave series', () => {
        renderActions(48);
        const actions = screen.getByTestId('series-member-actions');
        expect(actions).toHaveTextContent('In for the series');
        expect(actions).toHaveTextContent('2 nights');
        expect(screen.getByRole('button', { name: 'Tentative' })).toBeInTheDocument();
        expect(screen.getByTestId('skip-this-night')).toHaveTextContent('Skip this night');
        expect(screen.getByTestId('leave-series')).toHaveTextContent('Leave series');
    });

    it('Skip this night calls the one-night cancel', () => {
        const { onSkip } = renderActions(48);
        fireEvent.click(screen.getByTestId('skip-this-night'));
        expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it('Leave series opens the confirm, which leaves on confirm', () => {
        renderActions(48);
        expect(screen.queryByTestId('leave-series-confirm')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId('leave-series'));
        expect(screen.getByRole('dialog')).toHaveTextContent('Leave “Weekly Raid Night”?');
        expect(screen.getByRole('dialog')).toHaveTextContent('taken off the 2 nights');
        fireEvent.click(screen.getByTestId('leave-series-confirm'));
        expect(env.mutate).toHaveBeenCalledTimes(1);
    });

    it('warns of a late cancel only when the next night is under 23 hours away', () => {
        renderActions(5);
        fireEvent.click(screen.getByTestId('leave-series'));
        expect(screen.getByTestId('leave-series-late-warning')).toHaveTextContent('less than 23 hours away');
    });

    it('shows no late-cancel warning when the next night is more than 23 hours away', () => {
        renderActions(48);
        fireEvent.click(screen.getByTestId('leave-series'));
        expect(screen.queryByTestId('leave-series-late-warning')).not.toBeInTheDocument();
    });

    it('counts and warns from every night Leave cancels, not only the nights from this page forward', () => {
        // Viewing next week's night; tonight (5h out) is also tagged and leave cancels it too.
        const state = seriesState([night(10, 168, 'in_series', 'signed_up'), night(11, 336, 'in_series', 'signed_up')], {
            membership: activeMembership(),
            leaveNights: [{ eventId: 9, startTime: new Date(Date.now() + 5 * 3600_000).toISOString() },
                { eventId: 10, startTime: state10() }, { eventId: 11, startTime: state11() }],
        });
        renderWithProviders(
            <SeriesMemberActions event={event} state={state} statusToggle={null} onSkip={vi.fn()} isSkipping={false} />,
        );
        fireEvent.click(screen.getByTestId('leave-series'));
        expect(screen.getByRole('dialog')).toHaveTextContent('taken off the 3 nights');
        expect(screen.getByTestId('leave-series-late-warning')).toHaveTextContent('less than 23 hours away');
    });
});
