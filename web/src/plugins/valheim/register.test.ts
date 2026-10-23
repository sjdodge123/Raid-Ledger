/** ROK-1837 — the Map tab is registered on Valheim server hubs through the ROK-1831 seam. */
import { describe, it, expect } from 'vitest';
import type { GuildPage } from '@raid-ledger/contract';
import type { HubCtx } from '../hub-module';
import { hubGameTabs } from '../hub-game-tabs';
import { serverHubGameTabs } from '../pelican/hub/server-hub-game-tabs';
import { usePluginStore } from '../../stores/plugin-store';
import './register';

describe('valheim register — hub Map tab', () => {
    it('registers a lazy `map` tab for valheim server hubs', () => {
        const tab = serverHubGameTabs().find((t) => t.id === 'map');
        expect(tab).toBeDefined();
        expect(tab?.label).toBe('Map');
        expect(tab?.order).toBe(20);
        expect(tab?.component.name).toBe('LazyValheimMapHubTab');
    });
});

describe('valheim register — hub Materials tab (ROK-1853)', () => {
    it('registers a lazy `materials` tab after the Map tab', () => {
        const tab = serverHubGameTabs().find((t) => t.id === 'materials');
        expect(tab?.label).toBe('Materials');
        expect(tab?.order).toBe(25);
        expect(tab?.component.name).toBe('LazyValheimMaterialsHubTab');
    });
});

describe('valheim register — game tabs on every hub kind (ROK-1912)', () => {
    const SERVER: NonNullable<GuildPage['server']> = { pelicanServerId: 4, gameSlug: 'valheim', gameIconUrl: null, state: 'running', viewerJoined: false };
    function ctx(kind: GuildPage['guild']['kind'], gameSlug: string, server?: GuildPage['server']): HubCtx {
        const guild: GuildPage['guild'] = {
            id: 9, gameId: 3, kind, name: 'Hub', region: 'server', realmSlug: null, realmName: null,
            faction: null, memberCount: 1, lastSnapshotAt: null, gameSlug,
        };
        const viewer: GuildPage['viewer'] = { role: 'member', canEdit: false, canManageEditors: false };
        const page: GuildPage = {
            guild, importedBy: null, viewer, ranks: [], roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
            ...(server === undefined ? {} : { server }),
        };
        // The gate reads only `page`; `raids` is never touched (hub-tabs.test idiom).
        return { page } as HubCtx;
    }
    const valheimIds = (c: HubCtx): string[] =>
        hubGameTabs().filter((t) => t.visible?.(c) ?? true).sort((a, b) => a.order - b.order).map((t) => `${t.id}:${t.label}`);

    it('shows Characters, Map, Materials, Planner in order on a Valheim server hub', () => {
        usePluginStore.getState().setActiveSlugs(['pelican', 'valheim']);
        expect(valheimIds(ctx('game_server', 'valheim', SERVER))).toEqual(['characters:Characters', 'map:Map', 'materials:Materials', 'planner:Planner']);
    });

    it('shows none of the four on a Valheim community hub (no server block — the tabs would be blank)', () => {
        usePluginStore.getState().setActiveSlugs(['pelican', 'valheim']);
        expect(valheimIds(ctx('game_community', 'valheim'))).toEqual([]);
    });

    it('shows none of the four on a Valheim server hub whose server block is gone (mapping cleared)', () => {
        usePluginStore.getState().setActiveSlugs(['pelican', 'valheim']);
        expect(valheimIds(ctx('game_server', 'valheim'))).toEqual([]);
    });

    it('shows no Valheim tab on a WoW or community hub of another game', () => {
        usePluginStore.getState().setActiveSlugs(['pelican', 'valheim', 'wow']);
        expect(valheimIds(ctx('wow_guild', 'world-of-warcraft'))).toEqual([]);
        expect(valheimIds(ctx('game_community', 'minecraft'))).toEqual([]);
    });

    it('shows no Valheim tab while the valheim plugin is inactive', () => {
        usePluginStore.getState().setActiveSlugs(['pelican']);
        expect(valheimIds(ctx('game_server', 'valheim', SERVER))).toEqual([]);
    });
});
