/**
 * ROK-1483 — the read-only Discord thread mirror client.
 *
 * There is exactly ONE call here and it is a GET: the mirror is a database
 * read the API has already performed against Postgres (D1), and the viewer
 * that consumes it has no write path at all (D15). Any future addition to this
 * module that is not a read belongs somewhere else.
 */
import {
    ThreadMessagesResponseSchema,
    type ThreadMessagesResponseDto,
    type ThreadSurfaceKind,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/**
 * Query of `GET /discord/threads/:threadId/messages`.
 *
 * `surfaceKind` + `surfaceId` are the caller's CLAIM about which app surface
 * the thread hangs off — the server resolves the real one and 403s a mismatch
 * (D3), so sending them is not an authorisation decision made here.
 */
export interface ThreadMessagesParams {
    surfaceKind: ThreadSurfaceKind;
    surfaceId: string;
    /** Exclusive `messageId` cursor — returns messages OLDER than this one. */
    before?: string;
    limit?: number;
}

/**
 * `GET /discord/threads/:threadId/messages` — one page of mirrored messages,
 * ascending by snowflake (oldest first, which is render order).
 *
 * @param threadId - Discord thread id the app has mirrored.
 * @param params - Surface claim plus optional backwards cursor and page size.
 * @returns The parsed page, including `hasMore`, `threadUrl` and `archived`.
 */
export async function getThreadMessages(
    threadId: string,
    params: ThreadMessagesParams,
): Promise<ThreadMessagesResponseDto> {
    const query = new URLSearchParams({
        surfaceKind: params.surfaceKind,
        surfaceId: params.surfaceId,
    });
    if (params.before !== undefined) query.set('before', params.before);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    return fetchApi(
        `/discord/threads/${encodeURIComponent(threadId)}/messages?${query.toString()}`,
        {},
        ThreadMessagesResponseSchema,
    );
}
