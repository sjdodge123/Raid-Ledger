/**
 * ROK-1876 — Resources sits in the core band, right after Events, on every
 * hub kind (operator ruling 2026-10-21, overrides ROK-1830 D7-A's "Resources
 * last"), so it is never several swipes away behind a long module band.
 */
import { describe, it, expect } from 'vitest';
import type { HubCtx, HubModule } from '../../plugins/hub-module';
import { hubTabs, visibleHubTabIds } from './hub-tabs';

const Empty = (): null => null;
/** No tab here has a `visible` gate, so `hubTabs` never reads the ctx. */
const ctx = {} as HubCtx;

function moduleWith(tabs: Array<{ id: string; order: number }>): HubModule {
    return {
        kind: 'game_server',
        tabs: tabs.map((t) => ({ ...t, label: t.id, component: Empty })),
        overviewWidgets: [],
        memberColumns: [],
        heroPills: [],
        memberRows: () => [],
    };
}

describe('hubTabs order', () => {
    it('puts Resources right after Events, ahead of every module tab', () => {
        const mod = moduleWith([
            { id: 'planner', order: 30 },
            { id: 'quick-play', order: 10 },
            { id: 'materials', order: 25 },
        ]);
        expect(hubTabs(mod, ctx, true).map((t) => t.id), 'core band is Overview, Members, Events, Resources; modules follow by order')
            .toEqual(['overview', 'members', 'events', 'resources', 'quick-play', 'materials', 'planner']);
    });

    it('keeps the slot but hides Resources until it has content', () => {
        const mod = moduleWith([{ id: 'raids', order: 10 }]);
        const tabs = hubTabs(mod, ctx, false);
        expect(tabs.map((t) => t.id)).toEqual(['overview', 'members', 'events', 'resources', 'raids']);
        expect(visibleHubTabIds(tabs)).toEqual(['overview', 'members', 'events', 'raids']);
    });

    it('with no module, Resources still follows Events', () => {
        expect(hubTabs(undefined, ctx, true).map((t) => t.id)).toEqual(['overview', 'members', 'events', 'resources']);
    });
});
