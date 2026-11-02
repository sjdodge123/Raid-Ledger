import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LeaveSeriesResponseDto, SeriesSignupDto } from '@raid-ledger/contract';
import { useJoinSeries, useLeaveSeries, useSeriesSignupState } from './use-series-signup';

const api = vi.hoisted(() => ({ getSeriesSignupState: vi.fn(), joinSeries: vi.fn(), leaveSeries: vi.fn() }));
vi.mock('../lib/api/series-signups-api', () => api);
const toasts = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('../lib/toast', () => ({ toast: toasts }));

const membership: SeriesSignupDto = {
    id: 7, recurrenceGroupId: '11111111-1111-4111-8111-111111111111', userId: 1, characterId: null, preferredRoles: null,
    status: 'left', endedReason: 'user_left', joinedAt: '2026-11-01T00:00:00.000Z', endedAt: '2026-11-02T00:00:00.000Z',
};

function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    return { wrapper, invalidate };
}

const keysOf = (spy: ReturnType<typeof setup>['invalidate']) => spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));

describe('use-series-signup', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('does not fetch the series state when disabled (a one-off event)', () => {
        const { wrapper } = setup();
        renderHook(() => useSeriesSignupState(10, false), { wrapper });
        expect(api.getSeriesSignupState).not.toHaveBeenCalled();
    });

    it('join invalidates every night\'s series state and the roster of each night it touched', async () => {
        api.joinSeries.mockResolvedValue({ membership, attachedEventIds: [10], createdEventIds: [11, 12], keptEventIds: [13], failed: [] });
        const { wrapper, invalidate } = setup();
        const { result } = renderHook(() => useJoinSeries(10), { wrapper });
        result.current.mutate({ characterId: '33333333-3333-4333-8333-333333333333' });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(api.joinSeries).toHaveBeenCalledWith(10, { characterId: '33333333-3333-4333-8333-333333333333' });
        const keys = keysOf(invalidate);
        expect(keys).toContain(JSON.stringify(['series-signup']));
        for (const id of [10, 11, 12]) expect(keys).toContain(JSON.stringify(['events', id, 'roster']));
        expect(keys).not.toContain(JSON.stringify(['events', 13, 'roster']));
    });

    it('leave warns of a late cancel when the api reports one', async () => {
        const res: LeaveSeriesResponseDto = { membership, cancelledEventIds: [10, 11], lateCancelledEventIds: [10] };
        api.leaveSeries.mockResolvedValue(res);
        const { wrapper } = setup();
        const { result } = renderHook(() => useLeaveSeries(10), { wrapper });
        result.current.mutate();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(toasts.warning).toHaveBeenCalledWith('You left the series', { description: 'Tonight counts as a late cancel.' });
        expect(toasts.success).not.toHaveBeenCalled();
    });

    it('leave toasts plain success when no night was a late cancel', async () => {
        api.leaveSeries.mockResolvedValue({ membership, cancelledEventIds: [11], lateCancelledEventIds: [] });
        const { wrapper } = setup();
        const { result } = renderHook(() => useLeaveSeries(10), { wrapper });
        result.current.mutate();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(toasts.success).toHaveBeenCalledWith('You left the series');
        expect(toasts.warning).not.toHaveBeenCalled();
    });
});
