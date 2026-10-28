import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { HubMediaListResponse } from '@raid-ledger/contract';
import { createTestQueryClient } from '../../../test/render-helpers';
import { useHubGalleryPages } from './use-hub-gallery-pages';

const fetchHubMedia = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/hub-media-api', () => ({ fetchHubMedia }));

const EMPTY: HubMediaListResponse = { items: [], nextCursor: null, total: 0, kinds: [] };

function wrapperFor(qc = createTestQueryClient()) {
    return {
        qc,
        wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    };
}

describe('useHubGalleryPages subject (ROK-2027)', () => {
    beforeEach(() => { fetchHubMedia.mockReset(); fetchHubMedia.mockResolvedValue(EMPTY); });

    it('a subject is sent WITHOUT a kind (filter all), D7', async () => {
        const { wrapper } = wrapperFor();
        renderHook(() => useHubGalleryPages(7, 'death', 'valheim-death:c42'), { wrapper });
        await waitFor(() => expect(fetchHubMedia).toHaveBeenCalledTimes(1));
        expect(fetchHubMedia).toHaveBeenCalledWith(7, { filter: 'all', limit: 24, subject: 'valheim-death:c42' });
    });

    it('no subject: the chip filter is sent and no subject key', async () => {
        const { wrapper } = wrapperFor();
        renderHook(() => useHubGalleryPages(7, 'death'), { wrapper });
        await waitFor(() => expect(fetchHubMedia).toHaveBeenCalledTimes(1));
        expect(fetchHubMedia).toHaveBeenCalledWith(7, { filter: 'death', limit: 24 });
    });

    it('the subject is part of the query key, under hubMediaKeys.all', async () => {
        const { qc, wrapper } = wrapperFor();
        renderHook(() => useHubGalleryPages(7, 'death', 'valheim-death:c42'), { wrapper });
        await waitFor(() => expect(fetchHubMedia).toHaveBeenCalledTimes(1));
        const keys = qc.getQueryCache().findAll({ queryKey: ['hub-media', 7] }).map((q) => q.queryKey);
        expect(keys).toEqual([['hub-media', 7, 'pages', 'death', 'valheim-death:c42']]);
    });

    it('a scoped grid opened after an unscoped one fetches with the subject', async () => {
        const { wrapper } = wrapperFor();
        const plain = renderHook(() => useHubGalleryPages(7, 'death'), { wrapper });
        await waitFor(() => expect(plain.result.current.loading).toBe(false));
        const scoped = renderHook(() => useHubGalleryPages(7, 'death', 'valheim-death:c42'), { wrapper });
        await waitFor(() => expect(scoped.result.current.loading).toBe(false));
        expect(fetchHubMedia).toHaveBeenCalledTimes(2);
        expect(fetchHubMedia).toHaveBeenLastCalledWith(7, { filter: 'all', limit: 24, subject: 'valheim-death:c42' });
    });
});
