/**
 * ROK-1483 — the newest page stays live while older pages accumulate.
 *
 * The viewer used to feed its `before` cursor straight into the poll's query
 * key, so the first "load older" click moved the POLL onto a frozen historical
 * page: AC1 ("a reply appears within one poll") stopped holding for that reader
 * until they remounted the route. Splitting the two responsibilities is the
 * smallest fix that keeps AC1 true for a reader who has paged back:
 *
 *   - the LIVE query never carries a cursor, so D11's whole-page refetch keeps
 *     observing edits and deletes on the page a reply would land on;
 *   - OLDER pages are fetched once each and accumulated, because history above
 *     the newest page is not what the poll exists to watch.
 *
 * It lives in `hooks/` rather than in `components/discord/` so the viewer file
 * stays inside its 150-line budget.
 */
import { useCallback, useMemo, useState } from 'react';
import type { ThreadMessageDto, ThreadSurfaceRef } from '@raid-ledger/contract';
import { getThreadMessages } from '../lib/api/discord-threads-api';
import { useThreadMessages } from './use-thread-messages';

/** One thread as the viewer renders it: a merged list plus its pager. */
export interface ThreadPages {
    /** Oldest first — accumulated history followed by the live newest page. */
    messages: ThreadMessageDto[];
    threadUrl: string | null;
    archived: boolean;
    isLoading: boolean;
    /** Whether anything older than `messages[0]` is still unread. */
    hasMore: boolean;
    /** Loads one more page of history; a no-op while one is in flight. */
    loadOlder: () => void;
}

/**
 * Keeps the first occurrence of each `messageId`, preserving order.
 *
 * Needed because the newest page moves between an older page being fetched and
 * the next poll landing, which can make the two pages overlap by a message.
 */
function dedupe(messages: ThreadMessageDto[]): ThreadMessageDto[] {
    const seen = new Set<string>();
    return messages.filter((message) => {
        if (seen.has(message.messageId)) return false;
        seen.add(message.messageId);
        return true;
    });
}

interface OlderPages {
    messages: ThreadMessageDto[];
    hasMore: boolean | undefined;
    fetchBefore: (oldest: string | undefined) => void;
}

/**
 * The backwards pager: one fetch per click, prepended to what is already held.
 *
 * Deliberately imperative rather than a second `useQuery` — an older page is
 * read once and never polled, so caching it under a cursor key would only add
 * a refetch schedule for data the viewer has no reason to re-read. A failed
 * page leaves history exactly as it was; the live query keeps polling, so the
 * panel never becomes unusable because the pager missed.
 */
function useOlderPages(
    threadId: string,
    surface: ThreadSurfaceRef,
): OlderPages {
    const [messages, setMessages] = useState<ThreadMessageDto[]>([]);
    const [hasMore, setHasMore] = useState<boolean | undefined>(undefined);
    const [pending, setPending] = useState(false);
    const { kind, id } = surface;

    const fetchBefore = useCallback(
        (oldest: string | undefined) => {
            if (pending || oldest === undefined) return;
            setPending(true);
            void getThreadMessages(threadId, {
                surfaceKind: kind,
                surfaceId: id,
                before: oldest,
            })
                .then((page) => {
                    setMessages((held) => dedupe([...page.messages, ...held]));
                    setHasMore(page.hasMore);
                })
                .catch(() => undefined)
                .finally(() => setPending(false));
        },
        [pending, threadId, kind, id],
    );

    return { messages, hasMore, fetchBefore };
}

/**
 * One thread as the viewer sees it: a polled newest page, the older pages the
 * reader asked for, and a pager that never freezes the poll.
 *
 * @param threadId - Mirrored Discord thread to read.
 * @param surface - The `(kind, id)` surface claim sent with every request.
 * @returns The merged message list plus the pager's state and trigger.
 */
export function useThreadPages(
    threadId: string,
    surface: ThreadSurfaceRef,
): ThreadPages {
    const { data, isLoading } = useThreadMessages(threadId, surface);
    const older = useOlderPages(threadId, surface);
    const newest = data?.messages;
    const messages = useMemo(
        () => dedupe([...older.messages, ...(newest ?? [])]),
        [older.messages, newest],
    );
    const oldest = messages[0]?.messageId;
    return {
        messages,
        threadUrl: data?.threadUrl ?? null,
        archived: data?.archived ?? false,
        isLoading,
        hasMore: older.hasMore ?? data?.hasMore ?? false,
        loadOlder: () => older.fetchBefore(oldest),
    };
}
