/** ROK-1870 — Guild vs Hubs nav highlight is kind-aware. */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { hubIdFromPath, useHubNavActive } from './use-hub-nav-active';

const state = vi.hoisted(() => ({ kind: 'wow_guild' }));

vi.mock('../../hub/api/use-guild', () => ({
    useGuildPage: (id: number) => ({ data: id > 0 ? { guild: { kind: state.kind } } : undefined }),
}));
vi.mock('./my-hubs-queries', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./my-hubs-queries')>()),
    useMyGuilds: () => [],
}));

describe('useHubNavActive', () => {
    it('parses the hub id from a hub path only', () => {
        expect(hubIdFromPath('/guilds/310')).toBe(310);
        expect(hubIdFromPath('/guilds/310/settings')).toBe(310);
        expect(hubIdFromPath('/players')).toBe(0);
    });

    it('a community hub page lights Hubs, not Guild', () => {
        state.kind = 'game_community';
        const { result } = renderHook(() => useHubNavActive('/guilds/310'));
        expect(result.current).toEqual({ guild: false, hubs: true });
    });

    it('a WoW guild page lights Guild, not Hubs', () => {
        state.kind = 'wow_guild';
        const { result } = renderHook(() => useHubNavActive('/guilds/11'));
        expect(result.current).toEqual({ guild: true, hubs: false });
    });

    it('the directory lights Hubs', () => {
        const { result } = renderHook(() => useHubNavActive('/hubs'));
        expect(result.current).toEqual({ guild: false, hubs: true });
    });
});
