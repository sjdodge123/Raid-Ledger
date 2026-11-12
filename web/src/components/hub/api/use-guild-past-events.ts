/**
 * ROK-2185 item 3 — the Events tab's "Show more" source: the hub's full
 * ended-event history, 20 a page, via `GET /guilds/:id/events/past`.
 * Membership-gated, so viewer-scoped like `useGuildRaids`; `enabled` is false
 * for a viewer the route would refuse (a visitor), so it is never asked.
 */
import { useInfiniteQuery, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';
import type { GuildPastEventsPageDto } from '@raid-ledger/contract';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { fetchGuildPastEvents } from './guild-api';
import { guildPageKey } from './use-guild';

export type GuildPastEventsQuery = UseInfiniteQueryResult<InfiniteData<GuildPastEventsPageDto, string | null>, Error>;

/** Paged past events for one hub; the cursor is opaque and passed back verbatim. */
export function useGuildPastEvents(guildId: number, enabled: boolean): GuildPastEventsQuery {
    const viewer = useViewerCacheScope();
    return useInfiniteQuery({
        queryKey: [...guildPageKey(guildId), 'past-events', viewer],
        queryFn: ({ pageParam }) => fetchGuildPastEvents(guildId, pageParam),
        initialPageParam: null as string | null,
        getNextPageParam: (last) => last.nextCursor,
        enabled: enabled && guildId > 0,
        retry: false,
    });
}
