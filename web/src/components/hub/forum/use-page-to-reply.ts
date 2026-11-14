/**
 * ROK-1175 (D9) — `?reply=<id>` may point past the thread's first reply page.
 * Keep fetching reply pages until the target is loaded, the thread runs out,
 * a page fails, or `FORUM_REPLY_AUTO_PAGES` pages have been pulled for it —
 * then `ForumMessage` scrolls the rendered target into view.
 */
import { useEffect, useRef } from 'react';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { HubForumThread } from '@raid-ledger/contract';

/** Upper bound on pages fetched automatically for one target. */
export const FORUM_REPLY_AUTO_PAGES = 20;

type ThreadQuery = UseInfiniteQueryResult<InfiniteData<HubForumThread>, Error>;

function isLoaded(query: ThreadQuery, replyId: number): boolean {
    return query.data?.pages.some((p) => p.replies.some((r) => r.id === replyId)) ?? false;
}

/** Pages the thread forward until `replyId` is on screen (bounded; see file docstring). */
export function usePageToReply(query: ThreadQuery, replyId: number | null): void {
    const budget = useRef<{ target: number | null; used: number }>({ target: null, used: 0 });
    const found = replyId !== null && isLoaded(query, replyId);
    const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = query;
    useEffect(() => {
        if (replyId === null || found || !hasNextPage || isFetching || isFetchNextPageError) return;
        if (budget.current.target !== replyId) budget.current = { target: replyId, used: 0 };
        if (budget.current.used >= FORUM_REPLY_AUTO_PAGES) return;
        budget.current.used += 1;
        void fetchNextPage();
    }, [replyId, found, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage]);
}
