import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { SeriesSignupStateDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { createMockEvent } from '../../../test/factories';
import { SeriesNotSignedUpSlot, SeriesSignedUpActions } from './SeriesSignupSlots';
import { activeMembership, night, seriesState } from './series-signup.test-helpers';

const env = vi.hoisted(() => ({ state: undefined as SeriesSignupStateDto | undefined }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: vi.fn(() => true) }));
vi.mock('../../../hooks/use-series-signup', () => ({
    useSeriesSignupState: vi.fn(() => ({ data: env.state })),
    useLeaveSeries: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useJoinSeries: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

const event = createMockEvent({ id: 10, title: 'Weekly Raid Night', recurrenceGroupId: '22222222-2222-4222-8222-222222222222' });
const member = (tonight: SeriesSignupStateDto['nights'][number]['state']) =>
    seriesState([night(10, 48, tonight), night(11, 216, 'in_series', 'signed_up')], { membership: activeMembership() });

function renderSignedUp() {
    renderWithProviders(
        <SeriesSignedUpActions event={event} statusToggle={<button type="button">Tentative</button>}
            leave={<button type="button">Leave</button>} onSkip={vi.fn()} isSkipping={false} />,
    );
}

describe('SeriesNotSignedUpSlot', () => {
    beforeEach(() => { env.state = undefined; });

    it('shows the skipped-night line for a member who declined this night', () => {
        env.state = member('stays_inactive');
        renderWithProviders(<SeriesNotSignedUpSlot event={event} />);
        expect(screen.getByTestId('series-skipped-night')).toHaveTextContent('back on the next night');
    });

    it.each(['will_create', 'will_attach'] as const)('shows no skipped-night line for a member whose night is %s', (state) => {
        env.state = member(state);
        renderWithProviders(<SeriesNotSignedUpSlot event={event} />);
        expect(screen.queryByTestId('series-skipped-night')).not.toBeInTheDocument();
        expect(screen.queryByTestId('join-series-button')).not.toBeInTheDocument();
    });

    it('offers Join series to a non-member', () => {
        env.state = seriesState([night(10, 48, 'will_create'), night(11, 216, 'will_create')]);
        renderWithProviders(<SeriesNotSignedUpSlot event={event} />);
        expect(screen.getByTestId('join-series-button')).toHaveTextContent('Join series');
    });
});

describe('SeriesSignedUpActions', () => {
    beforeEach(() => { env.state = undefined; });

    it('swaps Leave for the series actions when the member is in for this night', () => {
        env.state = member('in_series');
        renderSignedUp();
        expect(screen.getByTestId('series-member-actions')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument();
    });

    it('keeps Tentative + Leave and adds Join series for a signed-up non-member', () => {
        env.state = seriesState([night(10, 48, 'will_attach', 'signed_up'), night(11, 216, 'will_create')]);
        renderSignedUp();
        expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument();
        expect(screen.getByTestId('join-series-button')).toBeInTheDocument();
        expect(screen.queryByTestId('series-member-actions')).not.toBeInTheDocument();
    });
});
