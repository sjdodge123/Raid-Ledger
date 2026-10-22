/**
 * ROK-1868 — hub leader posts API under core `/guilds/:id/posts` (§2.3).
 * Every response is parsed by its contract schema.
 */
import {
    CreateHubPostResponseSchema, HubPostComposerSchema, HubPostListSchema, HubPostSchema,
    type CreateHubPostInput, type CreateHubPostResponse, type HubPost, type HubPostComposer, type HubPostList,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

const postsBase = (guildId: number): string => `/guilds/${guildId}/posts`;

/** One page, newest first; `cursor` is the previous page's `nextCursor`. */
export function fetchHubPosts(guildId: number, cursor?: string | null, limit?: number): Promise<HubPostList> {
    const qs = new URLSearchParams();
    if (cursor) qs.set('cursor', cursor);
    if (limit !== undefined) qs.set('limit', String(limit));
    const query = qs.toString();
    return fetchApi(`${postsBase(guildId)}${query ? `?${query}` : ''}`, {}, HubPostListSchema);
}

/** One post (the deep-link target). */
export function fetchHubPost(guildId: number, postId: number): Promise<HubPost> {
    return fetchApi(`${postsBase(guildId)}/${postId}`, {}, HubPostSchema);
}

/** Editors only — the remembered relay default + the bound channel's state. */
export function fetchHubPostComposer(guildId: number): Promise<HubPostComposer> {
    return fetchApi(`${postsBase(guildId)}/composer`, {}, HubPostComposerSchema);
}

/** Publish; the response says whether the Discord relay landed (D7). */
export function createHubPost(guildId: number, input: CreateHubPostInput): Promise<CreateHubPostResponse> {
    return fetchApi(postsBase(guildId), { method: 'POST', body: JSON.stringify(input) }, CreateHubPostResponseSchema);
}

/** Edit the body; the Discord message is never touched (D3). */
export function updateHubPost(guildId: number, postId: number, body: string): Promise<HubPost> {
    return fetchApi(`${postsBase(guildId)}/${postId}`, { method: 'PATCH', body: JSON.stringify({ body }) }, HubPostSchema);
}

export function deleteHubPost(guildId: number, postId: number): Promise<void> {
    return fetchApi<void>(`${postsBase(guildId)}/${postId}`, { method: 'DELETE' });
}
