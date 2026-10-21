/** ROK-1875 (Codex r1): a server-hub Join/Leave refreshes every surface that lists the hub's membership. */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../../../test/render-helpers';
import { useHubJoin } from './server-hub-api';

vi.mock('../../../lib/api-client', () => ({
    fetchApi: vi.fn().mockResolvedValue({ joined: true, memberCount: 3 }),
}));
vi.mock('../../../hooks/use-auth', () => ({ useViewerCacheScope: () => 'user:1' }));

describe('useHubJoin', () => {
    it('invalidates the /hubs directory, the nav and the game cards after a Join', async () => {
        const qc = createTestQueryClient();
        const spy = vi.spyOn(qc, 'invalidateQueries');
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
        const { result } = renderHook(() => useHubJoin(7), { wrapper });
        await act(async () => {
            await result.current.mutateAsync(true);
        });
        const keys = spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
        expect(keys).toContain(JSON.stringify(['hubs-directory']));
        expect(keys).toContain(JSON.stringify(['game-hubs']));
    });
});
