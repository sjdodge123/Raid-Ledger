import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { SeriesSignupStateDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { createMockEvent } from '../../../test/factories';
import { JoinSeriesButton } from './JoinSeriesButton';
import { activeMembership, night, seriesState } from './series-signup.test-helpers';

const hook = vi.hoisted(() => ({ state: undefined as SeriesSignupStateDto | undefined, enabled: [] as boolean[] }));
vi.mock('../../../hooks/use-series-signup', () => ({
    useSeriesSignupState: vi.fn((_id: number, enabled: boolean) => { hook.enabled.push(enabled); return { data: enabled ? hook.state : undefined }; }),
    useJoinSeries: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

const GROUP = '22222222-2222-4222-8222-222222222222';
const seriesEvent = (overrides = {}) => createMockEvent({ id: 10, recurrenceGroupId: GROUP, ...overrides });

describe('JoinSeriesButton', () => {
    beforeEach(() => { hook.enabled = []; hook.state = seriesState([night(10, 48, 'will_create'), night(11, 216, 'will_create')]); });

    it('shows "Join series" for a joinable series night', () => {
        renderWithProviders(<JoinSeriesButton event={seriesEvent()} />);
        expect(screen.getByTestId('join-series-button')).toHaveTextContent('Join series');
    });

    it('is hidden for a one-off event and never fetches its series state', () => {
        renderWithProviders(<JoinSeriesButton event={createMockEvent({ id: 10, recurrenceGroupId: null })} />);
        expect(screen.queryByTestId('join-series-button')).not.toBeInTheDocument();
        expect(hook.enabled.every((e) => !e)).toBe(true);
    });

    it('is hidden for a cancelled night', () => {
        renderWithProviders(<JoinSeriesButton event={seriesEvent({ cancelledAt: '2026-11-01T00:00:00.000Z' })} />);
        expect(screen.queryByTestId('join-series-button')).not.toBeInTheDocument();
    });

    it('is hidden when no night is left to join', () => {
        hook.state = seriesState([night(10, 48, 'stays_inactive', 'declined')]);
        renderWithProviders(<JoinSeriesButton event={seriesEvent()} />);
        expect(hook.state.joinableCount).toBe(0);
        expect(screen.queryByTestId('join-series-button')).not.toBeInTheDocument();
    });

    it('is hidden for a series member', () => {
        hook.state = seriesState([night(10, 48, 'in_series', 'signed_up'), night(11, 216, 'will_create')], { membership: activeMembership() });
        renderWithProviders(<JoinSeriesButton event={seriesEvent()} />);
        expect(screen.queryByTestId('join-series-button')).not.toBeInTheDocument();
    });

    it('is hidden on a past night (not in the future nights list)', () => {
        hook.state = seriesState([night(11, 216, 'will_create')]);
        renderWithProviders(<JoinSeriesButton event={seriesEvent()} />);
        expect(screen.queryByTestId('join-series-button')).not.toBeInTheDocument();
    });
});
