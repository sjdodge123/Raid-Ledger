/** ROK-2352 — lock-in sends `lfgGroupKey` for a keyed group, nothing for `''`. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const createEvent = vi.fn();
vi.mock('../lib/api/events-api', () => ({
    createEvent: (...args: unknown[]) => createEvent(...args),
}));
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useLockInEvent } from './use-lfg-lock-in';

const WINDOW = { start: '2026-09-23T01:00:00.000Z', end: '2026-09-23T03:00:00.000Z' };

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => createEvent.mockReset().mockResolvedValue({ id: 1 }));

describe('useLockInEvent — group scope', () => {
    it('sends lfgGroupKey for a keyed group', async () => {
        const { result } = renderHook(() => useLockInEvent(7, 'WoW', 'dungeon:36'), { wrapper });
        act(() => result.current.lockIn(WINDOW));
        await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
        expect(createEvent.mock.calls[0]?.[0]).toMatchObject({ lfgGameId: 7, lfgGroupKey: 'dungeon:36' });
    });

    it('sends no lfgGroupKey for the whole-game group', async () => {
        const { result } = renderHook(() => useLockInEvent(7, 'Valheim'), { wrapper });
        act(() => result.current.lockIn(WINDOW));
        await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
        expect(createEvent.mock.calls[0]?.[0]).not.toHaveProperty('lfgGroupKey');
    });

    it('sends lfgChosenGroupKey only for the Any group', async () => {
        const any = renderHook(() => useLockInEvent(7, 'WoW'), { wrapper });
        act(() => any.result.current.lockIn(WINDOW, undefined, 'raid:409'));
        await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
        expect(createEvent.mock.calls[0]?.[0]).toMatchObject({ lfgGameId: 7, lfgChosenGroupKey: 'raid:409' });
        expect(createEvent.mock.calls[0]?.[0]).not.toHaveProperty('lfgGroupKey');
        const keyed = renderHook(() => useLockInEvent(7, 'WoW', 'dungeon:36'), { wrapper });
        act(() => keyed.result.current.lockIn(WINDOW, undefined, 'raid:409'));
        await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(2));
        expect(createEvent.mock.calls[1]?.[0]).not.toHaveProperty('lfgChosenGroupKey');
    });
});
