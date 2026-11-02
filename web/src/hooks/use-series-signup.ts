import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { JoinSeriesDto, SeriesNightFailureDto } from '@raid-ledger/contract';
import { getSeriesSignupState, joinSeries, leaveSeries } from '../lib/api/series-signups-api';
import { toast } from '../lib/toast';
import { invalidateRosterQueries } from './use-roster';
import { eventCopyKey } from './use-calendar-sync';

/** Root of every night's series state; a join or leave changes all of them. */
export const SERIES_SIGNUP_KEY = 'series-signup';
export const seriesSignupKey = (eventId: number) => [SERIES_SIGNUP_KEY, eventId] as const;

/** Every night's series state, plus the roster and calendar copy of each night the call touched. */
function invalidateSeriesNights(queryClient: QueryClient, eventIds: readonly number[]): void {
    void queryClient.invalidateQueries({ queryKey: [SERIES_SIGNUP_KEY] });
    for (const id of new Set(eventIds)) {
        invalidateRosterQueries(queryClient, id);
        void queryClient.invalidateQueries({ queryKey: eventCopyKey(id) });
    }
}

/** The viewer's series state for this night; `enabled` only for a series event. */
export function useSeriesSignupState(eventId: number, enabled: boolean) {
    return useQuery({
        queryKey: seriesSignupKey(eventId),
        queryFn: () => getSeriesSignupState(eventId),
        enabled,
    });
}

/** A warning toast for nights the join/leave could not apply (best-effort per night, D5). */
function warnFailedNights(failed: readonly SeriesNightFailureDto[] | undefined, verb: string): void {
    const first = failed?.[0];
    if (!failed || !first) return;
    toast.warning(`${failed.length} ${failed.length === 1 ? 'night' : 'nights'} could not be ${verb}`, { description: first.message });
}

/** Joins the series from `eventId` forward. */
export function useJoinSeries(eventId: number) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (dto: JoinSeriesDto) => joinSeries(eventId, dto),
        onSuccess: (res) => {
            invalidateSeriesNights(queryClient, [eventId, ...res.attachedEventIds, ...res.createdEventIds]);
            const joined = res.attachedEventIds.length + res.createdEventIds.length;
            toast.success('You joined the series', { description: `Signed up for ${joined} ${joined === 1 ? 'night' : 'nights'}.` });
            warnFailedNights(res.failed, 'joined');
        },
        onError: (err) => toast.error('Could not join the series', { description: err instanceof Error ? err.message : 'Please try again.' }),
    });
}

/** Leaves the series; warns when a cancelled night counts as a late cancel (<23h). */
export function useLeaveSeries(eventId: number) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => leaveSeries(eventId),
        onSuccess: (res) => {
            invalidateSeriesNights(queryClient, [eventId, ...res.cancelledEventIds]);
            if (res.lateCancelledEventIds.length > 0) toast.warning('You left the series', { description: 'Tonight counts as a late cancel.' });
            else toast.success('You left the series');
            warnFailedNights(res.failed, 'cancelled');
        },
        onError: (err) => toast.error('Could not leave the series', { description: err instanceof Error ? err.message : 'Please try again.' }),
    });
}
