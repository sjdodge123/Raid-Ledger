/**
 * ROK-2226 — a reply on a hub thread refreshes the event page's Discussion
 * card: the forum write does not know the event id, so every cached event
 * discussion is marked stale (the card has a 30 s staleTime otherwise).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateForumReply, useDeleteForumReply } from './use-hub-forum';

const api = vi.hoisted(() => ({ createForumReply: vi.fn(), deleteForumReply: vi.fn() }));
vi.mock('./hub-forum-api', () => api);

function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    queryClient.setQueryData(['events', 5, 'discussion', 'u1'], { state: 'none' });
    queryClient.setQueryData(['events', 5, 'detail'], { id: 5 });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const stale = (key: unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    return { wrapper, stale };
}

describe('hub forum reply writes refresh event discussion cards (ROK-2226)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('posting a reply marks the event card summary stale, not the event detail', async () => {
        api.createForumReply.mockResolvedValue({ id: 1 });
        const { wrapper, stale } = setup();
        const { result } = renderHook(() => useCreateForumReply(7), { wrapper });
        result.current.mutate({ threadId: 3, body: 'hi' });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(stale(['events', 5, 'discussion', 'u1'])).toBe(true);
        expect(stale(['events', 5, 'detail'])).toBe(false);
    });

    it('deleting a reply marks the event card summary stale', async () => {
        api.deleteForumReply.mockResolvedValue(undefined);
        const { wrapper, stale } = setup();
        const { result } = renderHook(() => useDeleteForumReply(7), { wrapper });
        result.current.mutate({ threadId: 3, replyId: 9 });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(stale(['events', 5, 'discussion', 'u1'])).toBe(true);
    });
});
