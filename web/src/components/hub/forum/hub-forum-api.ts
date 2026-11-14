/**
 * ROK-1175 — hub forum API under core `/guilds/:id/forum` (spec §API).
 * Every JSON response is parsed by its contract schema; pin/unpin and the
 * deletes return 204 (no body).
 */
import {
    HubForumLatestSchema, HubForumReplySchema, HubForumThreadListSchema, HubForumThreadSchema,
    type CreateHubForumThreadInput, type HubForumLatest, type HubForumReply, type HubForumThread,
    type HubForumThreadList, type UpdateHubForumThreadInput,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

const forumBase = (guildId: number): string => `/guilds/${guildId}/forum`;
const threadPath = (guildId: number, threadId: number): string => `${forumBase(guildId)}/${threadId}`;
const replyPath = (guildId: number, threadId: number, replyId: number): string =>
    `${threadPath(guildId, threadId)}/replies/${replyId}`;

/** One page of threads, latest activity first; `pinned` comes on the first page only. */
export function fetchForumThreads(guildId: number, cursor?: string | null): Promise<HubForumThreadList> {
    const query = cursor ? `?${new URLSearchParams({ cursor }).toString()}` : '';
    return fetchApi(`${forumBase(guildId)}${query}`, {}, HubForumThreadListSchema);
}

/** One thread with its first page of replies (oldest first); `replyCursor` pages on. */
export function fetchForumThread(guildId: number, threadId: number, replyCursor?: string | null): Promise<HubForumThread> {
    const query = replyCursor ? `?${new URLSearchParams({ replyCursor }).toString()}` : '';
    return fetchApi(`${threadPath(guildId, threadId)}${query}`, {}, HubForumThreadSchema);
}

/** The Latest threads widget's three rows + the hub's thread total. */
export function fetchForumLatest(guildId: number): Promise<HubForumLatest> {
    return fetchApi(`${forumBase(guildId)}/latest`, {}, HubForumLatestSchema);
}

export function createForumThread(guildId: number, input: CreateHubForumThreadInput): Promise<HubForumThread> {
    return fetchApi(forumBase(guildId), { method: 'POST', body: JSON.stringify(input) }, HubForumThreadSchema);
}

export function updateForumThread(guildId: number, threadId: number, input: UpdateHubForumThreadInput): Promise<HubForumThread> {
    return fetchApi(threadPath(guildId, threadId), { method: 'PATCH', body: JSON.stringify(input) }, HubForumThreadSchema);
}

export function deleteForumThread(guildId: number, threadId: number): Promise<void> {
    return fetchApi<void>(threadPath(guildId, threadId), { method: 'DELETE' });
}

/** Officers/leaders/staff: `pinned` true = PUT, false = DELETE; idempotent, 204. */
export function setForumThreadPin(guildId: number, threadId: number, pinned: boolean): Promise<void> {
    return fetchApi<void>(`${threadPath(guildId, threadId)}/pin`, { method: pinned ? 'PUT' : 'DELETE' });
}

/** 409 "This thread was removed" when the root is deleted (Q8). */
export function createForumReply(guildId: number, threadId: number, body: string): Promise<HubForumReply> {
    return fetchApi(`${threadPath(guildId, threadId)}/replies`, { method: 'POST', body: JSON.stringify({ body }) }, HubForumReplySchema);
}

export function updateForumReply(guildId: number, threadId: number, replyId: number, body: string): Promise<HubForumReply> {
    return fetchApi(replyPath(guildId, threadId, replyId), { method: 'PATCH', body: JSON.stringify({ body }) }, HubForumReplySchema);
}

export function deleteForumReply(guildId: number, threadId: number, replyId: number): Promise<void> {
    return fetchApi<void>(replyPath(guildId, threadId, replyId), { method: 'DELETE' });
}
