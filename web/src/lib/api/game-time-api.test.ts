import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetchApi = vi.fn();

vi.mock('./fetch-api', () => ({
    fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}));

import { getMyGameTime } from './game-time-api';

describe('getMyGameTime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetchApi.mockResolvedValue({ data: { slots: [], overrides: [], absences: [] } });
    });

    it('passes cache: no-cache to fetchApi to prevent stale browser cache', async () => {
        await getMyGameTime();

        expect(mockFetchApi).toHaveBeenCalledTimes(1);
        const [, options] = mockFetchApi.mock.calls[0];
        expect(options).toEqual(expect.objectContaining({ cache: 'no-cache' }));
    });

    it('includes week param when provided', async () => {
        await getMyGameTime('2026-03-09');

        const [endpoint] = mockFetchApi.mock.calls[0];
        expect(endpoint).toContain('week=2026-03-09');
    });

    it('includes tzOffset in the query string', async () => {
        await getMyGameTime(undefined, 300);

        const [endpoint] = mockFetchApi.mock.calls[0];
        expect(endpoint).toContain('tzOffset=300');
    });
});
