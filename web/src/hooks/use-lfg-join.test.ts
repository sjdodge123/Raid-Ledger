/** ROK-2352 — join → N hands: one POST per group key, in order, stop on first error. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { withHttpStatus } from '../lib/api/api-error';

const createIntent = vi.fn();
vi.mock('../lib/api/lfg-api', () => ({
    createIntent: (...args: unknown[]) => createIntent(...args),
}));
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { raiseHands, useJoinGroup } from './use-lfg-join';

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
        createIntent.mockResolvedValueOnce({}).mockRejectedValueOnce(withHttpStatus(new Error('cap'), 409));
        await expect(raiseHands({ gameId: 7, groupKeys: ['dungeon:1', 'dungeon:2', 'dungeon:3'] })).rejects.toThrow('cap');
        expect(createIntent).toHaveBeenCalledTimes(2);
    });
});

describe('useJoinGroup', () => {
    it('refreshes every LFG read even when a later hand is refused (the earlier ones landed)', async () => {
        createIntent.mockResolvedValueOnce({}).mockRejectedValueOnce(withHttpStatus(new Error('cap'), 409));
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const invalidate = vi.spyOn(client, 'invalidateQueries');
        const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
        const onJoined = vi.fn();
        const { result } = renderHook(() => useJoinGroup(onJoined), { wrapper });
        result.current.mutate({ gameId: 7, groupKeys: ['dungeon:1', 'dungeon:2'] });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['lfg'] });
        expect(onJoined).not.toHaveBeenCalled();
    });
});
