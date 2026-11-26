/**
 * ROK-2360 — a roster-member character link (`/hubs/:id/members/:memberId`)
 * reads the WoW plugin's endpoint. With WoW off it must not be requested, and
 * the page reads the member as gone (404) instead of showing an error.
 */
import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { server } from '../test/mocks/server';
import { createTestQueryClient } from '../test/render-helpers';
import { usePluginStore } from '../stores/plugin-store';
import { useCharacterPageSource } from '../pages/character-detail-source';
import { useRosterMemberCharacter } from './use-roster-member-character';

const MEMBER_URL = 'http://localhost:3000/plugins/wow/guilds/:hubId/members/:memberId';
const CLAIMED_ID = '11111111-1111-4111-8111-111111111111';

let memberRequests = 0;

function setPlugins(active: string[]): void {
    usePluginStore.setState({ activeSlugs: new Set([CORE_PLUGIN_ID, ...active]), initialized: true, settled: true });
}

function wrapper({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={createTestQueryClient()}>
            <MemoryRouter initialEntries={['/hubs/12/members/34']}>
                <Routes><Route path="/hubs/:id/members/:memberId" element={<>{children}</>} /></Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );
}

beforeEach(() => {
    memberRequests = 0;
    server.use(http.get(MEMBER_URL, () => {
        memberRequests += 1;
        return HttpResponse.json({ claimedCharacterId: CLAIMED_ID });
    }));
});

describe('useRosterMemberCharacter (ROK-2360)', () => {
    it('requests the WoW roster member while WoW is active', async () => {
        setPlugins(['blizzard']);
        const { result } = renderHook(() => useRosterMemberCharacter('12', '34'), { wrapper });
        await waitFor(() => expect(result.current.data).toEqual({ claimedCharacterId: CLAIMED_ID }));
        expect(memberRequests).toBe(1);
    });

    it('makes no request while WoW is off', async () => {
        setPlugins([]);
        const { result } = renderHook(() => useRosterMemberCharacter('12', '34'), { wrapper });
        await new Promise((r) => setTimeout(r, 50));
        expect(result.current.fetchStatus).toBe('idle');
        expect(memberRequests).toBe(0);
    });
});

describe('useCharacterPageSource on a roster-member route (ROK-2360)', () => {
    it('follows the claimed character while WoW is active', async () => {
        setPlugins(['blizzard']);
        const { result } = renderHook(() => useCharacterPageSource(), { wrapper });
        await waitFor(() => expect(result.current).toEqual({ kind: 'redirect', to: `/characters/${CLAIMED_ID}` }));
    });

    it('reads the member as gone (404 on the hub) with no request while WoW is off', () => {
        setPlugins([]);
        const { result } = renderHook(() => useCharacterPageSource(), { wrapper });
        expect(result.current).toEqual({ kind: 'error', message: 'Roster member not found', status: 404, hubId: '12' });
        expect(memberRequests).toBe(0);
    });
});
