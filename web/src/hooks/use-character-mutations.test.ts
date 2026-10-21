/**
 * Character mutation hooks — a caller that shows an error inline opts it out
 * of the generic error toast, so the message appears once (ROK-1721).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from '../lib/toast';
import { createCharacter, deleteCharacter, updateCharacter } from '../lib/api-client';
import { isConflictError, withHttpStatus } from '../lib/api/api-error';
import { useCreateCharacter, useDeleteCharacter, useUpdateCharacter } from './use-character-mutations';

vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/api-client', () => ({
    createCharacter: vi.fn(), updateCharacter: vi.fn(), setMainCharacter: vi.fn(), deleteCharacter: vi.fn(),
}));

const CLAIMED = 'Ana Forever (US) is already claimed by another player';
const conflict = () => withHttpStatus(new Error(CLAIMED), 409);

function wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    return createElement(QueryClientProvider, { client: qc }, children);
}

async function failCreate(error: Error, opts?: Parameters<typeof useCreateCharacter>[0]) {
    vi.mocked(createCharacter).mockRejectedValueOnce(error);
    const { result } = renderHook(() => useCreateCharacter(opts), { wrapper });
    act(() => result.current.mutate({ gameId: 7, name: 'Ana Forever' } as never));
    await waitFor(() => expect(result.current.isError).toBe(true));
}

beforeEach(() => vi.mocked(toast.error).mockClear());

describe('useCreateCharacter — error toast', () => {
    it('does not toast an error the caller handles inline (409)', async () => {
        await failCreate(conflict(), { isHandledError: isConflictError });
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('still toasts an error the caller does not handle', async () => {
        await failCreate(withHttpStatus(new Error('boom'), 500), { isHandledError: isConflictError });
        expect(toast.error).toHaveBeenCalledWith('boom');
    });

    it('toasts every error when the caller opts nothing out', async () => {
        await failCreate(conflict());
        expect(toast.error).toHaveBeenCalledWith(CLAIMED);
    });
});

describe('useUpdateCharacter — error toast', () => {
    it('does not toast a 409 the caller handles inline', async () => {
        vi.mocked(updateCharacter).mockRejectedValueOnce(conflict());
        const { result } = renderHook(() => useUpdateCharacter({ isHandledError: isConflictError }), { wrapper });
        act(() => result.current.mutate({ id: 'c-1', dto: { name: 'Ana Forever' } }));
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(toast.error).not.toHaveBeenCalled();
    });
});

describe('useDeleteCharacter — hub membership (ROK-1875, Codex r5 P2)', () => {
    it('refreshes the /hubs directory, the nav hubs and hub pages — WoW guild membership derives from characters', async () => {
        const keys: readonly (readonly unknown[])[] = [
            ['hubs-directory', { membership: 'all', sort: 'members' }],
            ['plugins', 'wow', 'guilds', 'mine', 'viewer-7'],
            ['plugins', 'wow', 'guilds', 41],
            ['game-hubs', 9],
        ];
        const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        for (const key of keys) qc.setQueryData(key, { seeded: true });
        vi.mocked(deleteCharacter).mockResolvedValueOnce(undefined as never);
        const { result } = renderHook(() => useDeleteCharacter(), {
            wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children),
        });
        act(() => result.current.mutate('c-1'));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        for (const key of keys) expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    });
});
