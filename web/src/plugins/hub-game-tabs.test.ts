/** ROK-1912 (epic ROK-1905 H3) — game-scoped hub tabs on every hub kind. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GuildPage } from '@raid-ledger/contract';
import type { HubCtx, HubModule, HubTab } from './hub-module';
import { clearRegistry, registerPlugin } from './plugin-registry';
import { hubGameTabs } from './hub-game-tabs';
import { registerServerHubGameTab, serverHubGameTabs } from './pelican/hub/server-hub-game-tabs';
import { hubModuleTabs, hubTabs, visibleHubTabIds } from '../components/hub/hub-tabs';
import { usePluginStore } from '../stores/plugin-store';

const Empty = (): null => null;

function tab(over: Partial<HubTab> = {}): HubTab {
    return { id: 'map', label: 'Map', order: 20, component: Empty, ...over };
}

function ctx(kind: GuildPage['guild']['kind'], gameSlug?: string): HubCtx {
    const page: GuildPage = {
        guild: {
            id: 7, gameId: 1, kind, name: 'Hub', region: 'us', realmSlug: null, realmName: null,
            faction: null, memberCount: 1, lastSnapshotAt: null, ...(gameSlug === undefined ? {} : { gameSlug }),
        },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
    return { page } as HubCtx;
}

function visibleIds(c: HubCtx): string[] {
    return hubGameTabs().filter((t) => t.visible?.(c) ?? true).map((t) => t.id);
}

beforeEach(() => {
    clearRegistry();
    usePluginStore.getState().setActiveSlugs(['valheim', 'wow']);
});

describe('PluginHandle.registerHubGameTab', () => {
    it('shows a tab for game X on every hub kind whose gameSlug is X', () => {
        registerPlugin('valheim', { icon: 'x', color: 'c', label: 'Valheim' }).registerHubGameTab(['valheim'], tab());
        for (const kind of ['game_server', 'game_community', 'wow_guild'] as const) {
            expect(visibleIds(ctx(kind, 'valheim')), kind).toEqual(['map']);
        }
    });

    it('hides it on another game and on a page with no gameSlug', () => {
        registerPlugin('valheim', { icon: 'x', color: 'c', label: 'Valheim' }).registerHubGameTab(['valheim'], tab());
        expect(visibleIds(ctx('wow_guild', 'world-of-warcraft'))).toEqual([]);
        expect(visibleIds(ctx('game_community', 'minecraft'))).toEqual([]);
        expect(visibleIds(ctx('game_community'))).toEqual([]);
    });

    it('hides it while the registering plugin is inactive', () => {
        registerPlugin('valheim', { icon: 'x', color: 'c', label: 'Valheim' }).registerHubGameTab(['valheim'], tab());
        usePluginStore.getState().setActiveSlugs(['wow']);
        expect(visibleIds(ctx('game_server', 'valheim'))).toEqual([]);
    });

    it('matches any of several game slugs, and still honours the tab’s own `visible`', () => {
        const handle = registerPlugin('wow', { icon: 'x', color: 'c', label: 'WoW' });
        handle.registerHubGameTab(['forever', 'classic'], tab({ id: 'raids' }));
        handle.registerHubGameTab(['forever'], tab({ id: 'never', visible: () => false }));
        expect(visibleIds(ctx('wow_guild', 'classic'))).toEqual(['raids']);
        expect(visibleIds(ctx('wow_guild', 'forever'))).toEqual(['raids']);
    });

    it('replaces a re-registered tab by (pluginSlug, id) — HMR', () => {
        const handle = registerPlugin('valheim', { icon: 'x', color: 'c', label: 'Valheim' });
        handle.registerHubGameTab(['valheim'], tab({ label: 'Old' }));
        handle.registerHubGameTab(['valheim'], tab({ label: 'New' }));
        expect(hubGameTabs().map((t) => t.label)).toEqual(['New']);
    });
});

describe('registerServerHubGameTab — thin alias (ROK-1831)', () => {
    it('registers through the same registry, owned by `pluginSlug`', () => {
        registerServerHubGameTab('valheim', tab({ id: 'owned' }), 'valheim-extras');
        expect(serverHubGameTabs().map((t) => t.id)).toEqual(['owned']);
        expect(visibleIds(ctx('game_server', 'valheim'))).toEqual([]);
        usePluginStore.getState().setActiveSlugs(['valheim-extras']);
        expect(visibleIds(ctx('game_server', 'valheim'))).toEqual(['owned']);
    });
});

describe('hub tab frame merges game tabs into every kind', () => {
    const community: HubModule = {
        kind: 'game_community', tabs: [], overviewWidgets: [], memberColumns: [], heroPills: [], memberRows: () => [],
    };

    it('a community hub of the game gets the tab; one of another game does not', () => {
        registerPlugin('valheim', { icon: 'x', color: 'c', label: 'Valheim' }).registerHubGameTab(['valheim'], tab());
        expect(hubModuleTabs(community).map((t) => t.id)).toEqual(['map']);
        expect(visibleHubTabIds(hubTabs(community, ctx('game_community', 'valheim'), false))).toContain('map');
        expect(visibleHubTabIds(hubTabs(community, ctx('game_community', 'minecraft'), false))).not.toContain('map');
        expect(visibleHubTabIds(hubTabs(undefined, ctx('wow_guild', 'world-of-warcraft'), false))).not.toContain('map');
    });
});

describe('tab-id collisions — core and module tabs win over game tabs', () => {
    const withMap: HubModule = {
        kind: 'game_server', tabs: [tab({ id: 'map', label: 'Module map', order: 50 })],
        overviewWidgets: [], memberColumns: [], heroPills: [], memberRows: () => [],
    };
    afterEach(() => vi.restoreAllMocks());

    it('drops a game tab whose id a module tab already uses, with a dev warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        registerPlugin('valheim', { icon: 'x', color: 'c', label: 'Valheim' }).registerHubGameTab(['valheim'], tab());
        expect(hubModuleTabs(withMap).map((t) => t.label)).toEqual(['Module map']);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"map"'));
    });

    it('drops a game tab named like a core tab, and a second plugin’s duplicate id', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        registerPlugin('valheim', { icon: 'x', color: 'c', label: 'Valheim' }).registerHubGameTab(['valheim'], tab({ id: 'members' }));
        registerPlugin('wow', { icon: 'x', color: 'c', label: 'WoW' }).registerHubGameTab(['valheim'], tab({ id: 'raids', label: 'A' }));
        registerPlugin('extra', { icon: 'x', color: 'c', label: 'X' }).registerHubGameTab(['valheim'], tab({ id: 'raids', label: 'B' }));
        expect(hubModuleTabs(undefined).map((t) => `${t.id}:${t.label}`)).toEqual(['raids:A']);
        const ids = hubTabs(undefined, ctx('game_server', 'valheim'), true, true).map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
