/**
 * Subscribe link (ROK-1599): `POST /users/me/calendars/feed` creates the
 * link, or resets it (the old one stops working at once). The answer goes
 * straight into the cached overview so the new link shows without waiting
 * for the refetch, then the overview is refetched.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarFeedSchema, type CalendarFeed, type CalendarsOverview } from '@raid-ledger/contract';
import { fetchApi } from '../lib/api/fetch-api';
import { CALENDARS_OVERVIEW_KEY } from './use-calendar-sync';

export function useCreateOrResetFeed() {
    const queryClient = useQueryClient();
    return useMutation<CalendarFeed, Error, void>({
        mutationFn: () => fetchApi('/users/me/calendars/feed', { method: 'POST' }, CalendarFeedSchema),
        onSuccess: (feed) => {
            queryClient.setQueryData<CalendarsOverview>([...CALENDARS_OVERVIEW_KEY], (old) => (old ? { ...old, feed } : old));
            void queryClient.invalidateQueries({ queryKey: [...CALENDARS_OVERVIEW_KEY] });
        },
    });
}

/** Hands the `webcal:` link to the OS (its default calendar app) — the `goToProvider` idiom. */
export function leaveForCalendarApp(webcal: string): void {
    window.location.assign(webcal);
}
