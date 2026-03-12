/**
 * Unit tests for useGamesPricingBatch hook (ROK-800).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { useGamesPricingBatch } from './use-games-pricing-batch';

// Mock the API module
vi.mock('../lib/api-client', () => ({
    getGamePricingBatch: vi.fn(),
}));

import { getGamePricingBatch } from '../lib/api-client';

const mockGetBatch = vi.mocked(getGamePricingBatch);

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useGamesPricingBatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns empty map when no game IDs provided', () => {
        const { result } = renderHook(() => useGamesPricingBatch([]), {
            wrapper: createWrapper(),
        });

        expect(result.current.size).toBe(0);
        expect(mockGetBatch).not.toHaveBeenCalled();
    });

    it('fetches pricing for provided game IDs', async () => {
        mockGetBatch.mockResolvedValueOnce({
            data: {
                '1': {
                    currentBest: {
                        shop: 'Steam',
                        url: 'https://steam.com',
                        price: 29.99,
                        regularPrice: 59.99,
                        discount: 50,
                    },
                    stores: [],
                    historyLow: null,
                    dealQuality: 'modest',
                    currency: 'USD',
                    itadUrl: null,
                },
                '2': null,
            },
        });

        const { result } = renderHook(() => useGamesPricingBatch([1, 2]), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.size).toBe(2);
        });

        expect(result.current.get(1)).toMatchObject({
            currentBest: expect.objectContaining({ shop: 'Steam' }),
        });
        expect(result.current.get(2)).toBeNull();
    });

    it('deduplicates and sorts IDs for stable query key', async () => {
        mockGetBatch.mockResolvedValueOnce({ data: {} });

        renderHook(() => useGamesPricingBatch([3, 1, 3, 2, 1]), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(mockGetBatch).toHaveBeenCalledWith([1, 2, 3]);
        });
    });

    it('filters out non-positive IDs', async () => {
        mockGetBatch.mockResolvedValueOnce({ data: {} });

        renderHook(() => useGamesPricingBatch([0, -1, 5]), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(mockGetBatch).toHaveBeenCalledWith([5]);
        });
    });

    it('chunks IDs into batches of 100', async () => {
        const ids = Array.from({ length: 150 }, (_, i) => i + 1);
        const chunk1 = ids.slice(0, 100);
        const chunk2 = ids.slice(100);

        mockGetBatch
            .mockResolvedValueOnce({ data: Object.fromEntries(chunk1.map(id => [String(id), null])) })
            .mockResolvedValueOnce({ data: Object.fromEntries(chunk2.map(id => [String(id), null])) });

        const { result } = renderHook(() => useGamesPricingBatch(ids), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.size).toBe(150);
        });

        expect(mockGetBatch).toHaveBeenCalledTimes(2);
        expect(mockGetBatch).toHaveBeenCalledWith(chunk1);
        expect(mockGetBatch).toHaveBeenCalledWith(chunk2);
    });
});
