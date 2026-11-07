/** ROK-1928 review MINOR 16 — the roster-source read is gated to `wow_guild` hubs. */
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import { useRosterVia } from './use-guild-blizzard-roster';

function wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('useRosterVia', () => {
    it('fetches for a wow_guild hub but never for a game_community hub', async () => {
        const hits = new Map<string, number>();
        server.use(
            http.get('*/plugins/wow/guilds/:id/blizzard-roster', ({ params }) => {
                const id = String(params.id);
                hits.set(id, (hits.get(id) ?? 0) + 1);
                return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
            }),
        );
        const community = renderHook(() => useRosterVia({ id: 7, kind: 'game_community' }), { wrapper });
        const guild = renderHook(() => useRosterVia({ id: 8, kind: 'wow_guild' }), { wrapper });
        await waitFor(() => expect(hits.get('8')).toBe(1));
        expect(hits.get('7') ?? 0).toBe(0);
        expect([community.result.current, guild.result.current]).toEqual(['LedgerLink', 'LedgerLink']);
    });
});
