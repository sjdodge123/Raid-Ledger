/**
 * ROK-1797 (Codex P2) — the heart and bell mutations roll back optimistic
 * writes on error. If the viewer changes while the request is in flight
 * (admin impersonation switch), TanStack hands the mutation the NEW render's
 * callbacks, so a rollback built from render-time keys would write viewer A's
 * snapshot into viewer B's cache. The keys must be pinned when the mutation
 * starts and carried in its context.
 */
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { GameInterestResponseDto } from '@raid-ledger/contract';
import { server } from '../test/mocks/server';
import { setAccessToken } from '../lib/api/access-token-store';
import { toast } from '../lib/toast';
import { useGameNotificationMuteMutation } from './use-game-notification-mute';
import { useWantToPlay } from './use-want-to-play';
import { gameInterestQueryKey } from './game-interest-query-key';

const viewer = vi.hoisted(() => ({ id: 1 }));

vi.mock('./use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./use-auth')>()),
    useViewerCacheScope: () => viewer.id,
}));

vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const API = 'http://localhost:3000';
const GAME_ID = 7;
const KEY_A = gameInterestQueryKey(GAME_ID, 1);
const KEY_B = gameInterestQueryKey(GAME_ID, 2);
const SEED_A: GameInterestResponseDto = { wantToPlay: true, count: 1, notificationsMuted: false };
const SEED_B: GameInterestResponseDto = { wantToPlay: false, count: 3, notificationsMuted: true };

/** A write endpoint that stays pending until `release()` answers it with a 500. */
function gatedFailure(method: 'post' | 'delete', path: string) {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(
        http[method](`${API}${path}`, async () => {
            await gate;
            return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }),
        // A refetch of either viewer's entry must not overwrite what the rollback wrote.
        http.get(`${API}/games/${GAME_ID}/interest`, () => new Promise<never>(() => undefined)),
    );
    return () => release();
}

function seededClient() {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
    client.setQueryData(KEY_A, SEED_A);
    client.setQueryData(KEY_B, SEED_B);
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children);
    return { client, wrapper };
}

beforeEach(() => {
    setAccessToken('test-token');
    viewer.id = 1;
    vi.mocked(toast.error).mockClear();
});

describe('heart/bell rollback is pinned to the viewer who started the mutation', () => {
    it('a failed mute started as viewer A never writes into viewer B\'s cache', async () => {
        const release = gatedFailure('post', `/games/${GAME_ID}/notification-mute`);
        const { client, wrapper } = seededClient();
        const { result, rerender } = renderHook(
            () => useGameNotificationMuteMutation(GAME_ID), { wrapper });

        act(() => result.current.mutate(true));
        await waitFor(() => expect(client.getQueryData(KEY_A))
            .toMatchObject({ notificationsMuted: true }));

        viewer.id = 2;
        rerender();
        release();
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(client.getQueryData(KEY_B)).toEqual(SEED_B);
        expect(client.getQueryData(KEY_A)).toEqual(SEED_A);
    });

    it('a failed heart toggle started as viewer A never writes into viewer B\'s cache', async () => {
        const release = gatedFailure('delete', `/games/${GAME_ID}/want-to-play`);
        const { client, wrapper } = seededClient();
        const { result, rerender } = renderHook(() => useWantToPlay(GAME_ID), { wrapper });

        act(() => result.current.toggle(false));
        await waitFor(() => expect(client.getQueryData(KEY_A))
            .toMatchObject({ wantToPlay: false, count: 0 }));

        viewer.id = 2;
        rerender();
        release();
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update game interest'));

        expect(client.getQueryData(KEY_B)).toEqual(SEED_B);
        expect(client.getQueryData(KEY_A)).toEqual(SEED_A);
    });
});
