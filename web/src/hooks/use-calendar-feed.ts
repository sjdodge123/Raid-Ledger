/**
 * Subscribe link (ROK-1599): `POST /users/me/calendars/feed` creates the
 * link, or resets it (the old one stops working at once). The answer goes
 * straight into the cached overview so the new link shows without waiting
 * for the refetch, then the overview is refetched.
 *
 * The answer is a bearer URL for the viewer who POSTed it. A POST still in
 * flight across an identity change (logout, impersonation, another tab) must
 * not write it into the next viewer's cache, so the token identity is fenced:
 * captured at mutate time, re-checked before the cache write.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarFeedSchema, type CalendarFeed, type CalendarsOverview } from '@raid-ledger/contract';
import { fetchApi } from '../lib/api/fetch-api';
import { getAccessToken } from '../lib/api/access-token-store';
import { CALENDARS_OVERVIEW_KEY } from './use-calendar-sync';
import { tokenIdentity } from './viewer-private-caches';

interface FeedMutationContext {
    identity: string | null;
}

export function useCreateOrResetFeed() {
    const queryClient = useQueryClient();
    return useMutation<CalendarFeed, Error, void, FeedMutationContext>({
        onMutate: () => ({ identity: tokenIdentity(getAccessToken()) }),
        mutationFn: () => fetchApi('/users/me/calendars/feed', { method: 'POST' }, CalendarFeedSchema),
        onSuccess: (feed, _vars, context) => {
            const sameViewer = context.identity !== null && context.identity === tokenIdentity(getAccessToken());
            if (sameViewer) {
                queryClient.setQueryData<CalendarsOverview>([...CALENDARS_OVERVIEW_KEY], (old) => (old ? { ...old, feed } : old));
            }
            // A refetch under whoever is signed in now is always safe.
            void queryClient.invalidateQueries({ queryKey: [...CALENDARS_OVERVIEW_KEY] });
        },
    });
}
