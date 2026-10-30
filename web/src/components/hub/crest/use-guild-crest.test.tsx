import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode, JSX } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { GuildCrestEditorState } from '@raid-ledger/contract';
import * as api from './guild-crest-api';
import { shrinkCrestForUpload } from './crest-upload-shrink';
import { useGuildCrestEditor, usePickGuildCrestFromGallery, useSetGuildCrest, useUploadGuildCrest } from './use-guild-crest';

vi.mock('./guild-crest-api');
vi.mock('./crest-upload-shrink', () => ({ shrinkCrestForUpload: vi.fn() }));

const STATE: GuildCrestEditorState = { active: null, upload: null, preset: null, removedByStaffAt: null };

function setup(): { qc: QueryClient; wrapper: (p: { children: ReactNode }) => JSX.Element } {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return { qc, wrapper };
}

describe('useGuildCrest hooks', () => {
    beforeEach(() => { vi.mocked(api.fetchGuildCrest).mockResolvedValue(STATE); });

    it('fetches the editor state only when enabled', async () => {
        const { wrapper } = setup();
        renderHook(() => useGuildCrestEditor(7, false), { wrapper });
        expect(api.fetchGuildCrest).not.toHaveBeenCalled();
        const { result } = renderHook(() => useGuildCrestEditor(7, true), { wrapper });
        await waitFor(() => expect(result.current.data).toEqual(STATE));
    });

    it('PUTs the body and invalidates the hub page and crest carriers', async () => {
        vi.mocked(api.putGuildCrest).mockResolvedValue(STATE);
        const { qc, wrapper } = setup();
        const spy = vi.spyOn(qc, 'invalidateQueries');
        const { result } = renderHook(() => useSetGuildCrest(7), { wrapper });
        await act(() => result.current.mutateAsync({ active: null }));
        expect(api.putGuildCrest).toHaveBeenCalledWith(7, { active: null });
        const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
        expect(keys).toContainEqual(['plugins', 'wow', 'guilds']);
        expect(keys.some((k) => Array.isArray(k) && k.includes(7))).toBe(true);
    });

    it('shrinks the file before uploading it', async () => {
        const big = new File(['x'], 'big.png', { type: 'image/png' });
        const small = new File(['y'], 'big.jpg', { type: 'image/jpeg' });
        vi.mocked(shrinkCrestForUpload).mockResolvedValue(small);
        vi.mocked(api.postGuildCrestUpload).mockResolvedValue(STATE);
        const { wrapper } = setup();
        const { result } = renderHook(() => useUploadGuildCrest(7), { wrapper });
        await act(() => result.current.mutateAsync(big));
        expect(shrinkCrestForUpload).toHaveBeenCalledWith(big);
        expect(api.postGuildCrestUpload).toHaveBeenCalledWith(7, small);
    });

    it('posts a gallery pick as { mediaId }', async () => {
        vi.mocked(api.postGuildCrestFromGallery).mockResolvedValue(STATE);
        const { wrapper } = setup();
        const { result } = renderHook(() => usePickGuildCrestFromGallery(7), { wrapper });
        await act(() => result.current.mutateAsync(42));
        expect(api.postGuildCrestFromGallery).toHaveBeenCalledWith(7, { mediaId: 42 });
    });
});
