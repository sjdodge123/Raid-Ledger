/**
 * ROK-1797 (Codex P2) — the bell state and the muted-games list are
 * personalized, so their cache entries must never be served to a different
 * viewer. `logout()` only resets `['auth','me']`: sign out of user 1 and into
 * user 2 on the same QueryClient and user 2 must see their own mute, not
 * user 1's still-fresh (5-minute staleTime) entry.
 */
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { setAccessToken } from '../lib/api/access-token-store';
import { useGameNotificationMute } from './use-game-notification-mute';
import { gameInterestQueryKey, gameMutesQueryKey } from './game-interest-query-key';

const viewer = vi.hoisted(() => ({ id: 1 }));

vi.mock('./use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./use-auth')>()),
    useViewerCacheScope: () => viewer.id,
}));

const API = 'http://localhost:3000';
const GAME_ID = 7;
/** Server truth: user 1 muted the game, user 2 did not. */
const MUTED_BY_VIEWER: Record<number, boolean> = { 1: true, 2: false };

function wrapperFor(client: QueryClient) {
    return ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
    setAccessToken('test-token');
    viewer.id = 1;
    server.use(
        http.get(`${API}/games/${GAME_ID}/interest`, () =>
            HttpResponse.json({
                wantToPlay: true, count: 1, notificationsMuted: MUTED_BY_VIEWER[viewer.id] ?? false,
            })),
    );
});

describe('per-game mute caches are scoped to the viewer', () => {
    it('the interest and muted-games keys differ for two viewers', () => {
        expect(gameInterestQueryKey(GAME_ID, 1)).not.toEqual(gameInterestQueryKey(GAME_ID, 2));
        expect(gameMutesQueryKey(1)).not.toEqual(gameMutesQueryKey(2));
        expect(gameMutesQueryKey('anon')).not.toEqual(gameMutesQueryKey(1));
        // The viewer is LAST, so the unscoped prefix still invalidates every viewer.
        expect(gameInterestQueryKey(GAME_ID, 1).slice(0, 3)).toEqual(['games', 'interest', GAME_ID]);
    });

    it('the next viewer sees their own bell state, not the cached one', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { result, rerender } = renderHook(() => useGameNotificationMute(GAME_ID), {
            wrapper: wrapperFor(client),
        });
        await waitFor(() => expect(result.current.isReady).toBe(true));
        expect(result.current.muted).toBe(true);

        viewer.id = 2;
        rerender();
        await waitFor(() => expect(result.current.muted).toBe(false));
        expect(client.getQueryData(gameInterestQueryKey(GAME_ID, 1)))
            .toMatchObject({ notificationsMuted: true });
    });
});
