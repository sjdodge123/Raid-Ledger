/** ROK-2352 — join → N hands: one POST per group key, in order, stop on first error. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { withErrorBody, withHttpStatus } from '../lib/api/api-error';
import { toast } from '../lib/toast';

const createIntent = vi.fn();
vi.mock('../lib/api/lfg-api', () => ({
    createIntent: (...args: unknown[]) => createIntent(...args),
}));
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { LFG_HAND_CAP_COPY, isHandCapError, raiseHands, useJoinGroup } from './use-lfg-join';

/** The server's per-game cap refusal (apifix2: 400 + code, no longer 409). */
function capError(): Error {
    return withErrorBody(withHttpStatus(new Error('cap'), 400), { code: 'LFG_HAND_CAP', message: 'cap' });
}

beforeEach(() => createIntent.mockReset().mockResolvedValue({}));

describe('raiseHands', () => {
    it('posts the pre-ROK-2352 body for the whole-game group (no groupKey key)', async () => {
        await raiseHands({ gameId: 7, urgency: 'week' });
        expect(createIntent.mock.calls).toEqual([[{ gameId: 7, urgency: 'week' }]]);
    });

    it('raises one hand per key, in order, each with the hand detail', async () => {
        const handDetail = { roles: ['tank'], characterId: null };
        await raiseHands({ gameId: 7, urgency: 'now', ttlMinutes: 60, groupKeys: ['dungeon:1', 'raid:2', ''], handDetail });
        expect(createIntent.mock.calls).toEqual([
            [{ gameId: 7, urgency: 'now', ttlMinutes: 60, groupKey: 'dungeon:1', handDetail }],
            [{ gameId: 7, urgency: 'now', ttlMinutes: 60, groupKey: 'raid:2', handDetail }],
            [{ gameId: 7, urgency: 'now', ttlMinutes: 60, handDetail }],
        ]);
    });

    it('stops at the first refusal so later picks are not raised', async () => {
        createIntent.mockResolvedValueOnce({}).mockRejectedValueOnce(capError());
        await expect(raiseHands({ gameId: 7, groupKeys: ['dungeon:1', 'dungeon:2', 'dungeon:3'] })).rejects.toThrow('cap');
        expect(createIntent).toHaveBeenCalledTimes(2);
    });
});

describe('useJoinGroup', () => {
    it('refreshes every LFG read even when a later hand is refused (the earlier ones landed)', async () => {
        createIntent.mockResolvedValueOnce({}).mockRejectedValueOnce(capError());
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const invalidate = vi.spyOn(client, 'invalidateQueries');
        const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
        const onJoined = vi.fn();
        const { result } = renderHook(() => useJoinGroup(onJoined), { wrapper });
        result.current.mutate({ gameId: 7, groupKeys: ['dungeon:1', 'dungeon:2'] });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['lfg'] });
        expect(onJoined).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(LFG_HAND_CAP_COPY);
    });
});

describe('isHandCapError', () => {
    it('is true only for a 400 carrying the LFG_HAND_CAP code', () => {
        expect(isHandCapError(capError())).toBe(true);
        expect(isHandCapError(withErrorBody(withHttpStatus(new Error('x'), 400), { handDetail: ['Required'] }))).toBe(false);
        expect(isHandCapError(withHttpStatus(new Error('x'), 409))).toBe(false);
    });
});
