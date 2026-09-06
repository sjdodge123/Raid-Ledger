/**
 * ROK-1483 AC1 — a reply appears within one poll.
 *
 * The poll is a FULL refetch of one page rather than a delta (D11): a cursor
 * keyed on "newer than X" structurally cannot observe an edit or a delete to a
 * message already on screen, and AC1 requires both.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
    ThreadMessagesResponseDto,
    ThreadSurfaceRef,
} from '@raid-ledger/contract';
import { getThreadMessages } from '../lib/api/discord-threads-api';

/**
 * How often the open thread is refetched. Slow enough that an idle panel is
 * cheap, fast enough that "within one poll" reads as immediate to a human.
 */
export const THREAD_POLL_MS = 20_000;

/**
 * Poll one mirrored thread while the tab is visible.
 *
 * `refetchIntervalInBackground: false` is what implements "while visible":
 * TanStack's focus manager suspends the interval on a hidden document, so a
 * hand-rolled `visibilitychange` listener would only duplicate it. It is set
 * explicitly rather than left to the default so a library default change
 * cannot silently start polling every backgrounded tab.
 *
 * @param threadId - Thread to read; the query is disabled while undefined.
 * @param surface - The `(kind, id)` surface claim sent with every request.
 * @param before - Optional backwards cursor; part of the cache key so each
 *                 page is cached separately.
 */
export function useThreadMessages(
    threadId: string | undefined,
    surface: ThreadSurfaceRef,
    before?: string,
): UseQueryResult<ThreadMessagesResponseDto> {
    return useQuery({
        queryKey: [
            'discord-thread',
            threadId,
            surface.kind,
            surface.id,
            before,
        ],
        queryFn: () =>
            getThreadMessages(threadId as string, {
                surfaceKind: surface.kind,
                surfaceId: surface.id,
                before,
            }),
        refetchInterval: THREAD_POLL_MS,
        refetchIntervalInBackground: false,
        enabled: Boolean(threadId),
    });
}
