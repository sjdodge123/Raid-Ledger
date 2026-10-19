/**
 * ROK-1786: saving the GM post must refresh the Players page's `mine` query
 * (every viewer scope), whose `gmPostHeadline` would otherwise go stale.
 */
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { GuildProfile } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import { guildProfileKey, useUpdateGuildProfile } from './use-guild-content';

const PROFILE: GuildProfile = { guildId: 7, gmPost: null, rules: [], links: [] };

describe('useUpdateGuildProfile', () => {
    it('invalidates the profile and every viewer scope of the `mine` guild list', async () => {
        server.use(http.patch('http://localhost:3000/guilds/7/profile', () => HttpResponse.json(PROFILE)));
        const client = createTestQueryClient();
        const mineA = ['plugins', 'wow', 'guilds', 'mine', 'user:1'];
        const mineB = ['plugins', 'wow', 'guilds', 'mine', 'anon'];
        const profile = [...guildProfileKey(7), 'user:1'];
        for (const key of [mineA, mineB, profile]) client.setQueryData(key, { seeded: true });
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const { result } = renderHook(() => useUpdateGuildProfile(7), { wrapper });
        await act(() => result.current.mutateAsync({ gmPost: 'Raid tonight' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        const invalidated = (key: unknown[]) => client.getQueryState(key)?.isInvalidated;
        expect(invalidated(mineA), 'mine (user scope) must be invalidated').toBe(true);
        expect(invalidated(mineB), 'mine (anon scope) must be invalidated').toBe(true);
        expect(invalidated(profile), 'the profile must be invalidated').toBe(true);
    });
});
