/**
 * ROK-1876 — Resources sits in the core band, right after Events, on every
 * hub kind (operator ruling 2026-10-21, overrides ROK-1830 D7-A's "Resources
 * last"), so it is never several swipes away behind a long module band.
 */
import { describe, it, expect } from 'vitest';
import type { HubCtx, HubModule } from '../../plugins/hub-module';
import { hubTabs, visibleHubTabIds } from './hub-tabs';

const Empty = (): null => null;
/** No module tab here has a `visible` gate; core's Posts tab reads the hub kind and the viewer's role. */
function ctxAs(role: 'member' | 'visitor'): HubCtx {
    return { page: { guild: { kind: 'game_server' }, viewer: { role } } } as HubCtx;
}
const ctx = ctxAs('member');

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
        expect(hubTabs(mod, ctx, true).map((t) => t.id), 'core band is Overview, Members, Events, Resources, Posts; modules follow by order')
            .toEqual(['overview', 'members', 'events', 'resources', 'posts', 'quick-play', 'materials', 'planner']);
    });

    it('keeps the slot but hides Resources until it has content (and Posts until there is a post)', () => {
        const mod = moduleWith([{ id: 'raids', order: 10 }]);
        const tabs = hubTabs(mod, ctx, false);
        expect(tabs.map((t) => t.id)).toEqual(['overview', 'members', 'events', 'resources', 'posts', 'raids']);
        expect(visibleHubTabIds(tabs)).toEqual(['overview', 'members', 'events', 'raids']);
    });

    it('with no module, Resources still follows Events', () => {
        expect(hubTabs(undefined, ctx, true).map((t) => t.id)).toEqual(['overview', 'members', 'events', 'resources', 'posts']);
    });

    it('shows Posts (ROK-1868) after Resources once the hub has a post, never ahead of it', () => {
        const mod = moduleWith([{ id: 'quick-play', order: 10 }]);
        expect(visibleHubTabIds(hubTabs(mod, ctx, true, true)), 'Resources keeps its slot right after Events; Posts follows it')
            .toEqual(['overview', 'members', 'events', 'resources', 'posts', 'quick-play']);
        expect(visibleHubTabIds(hubTabs(mod, ctx, false, true))).toEqual(['overview', 'members', 'events', 'posts', 'quick-play']);
        expect(visibleHubTabIds(hubTabs(mod, ctxAs('visitor'), true, true)), 'a visitor cannot open the post routes')
            .toEqual(['overview', 'members', 'events', 'resources', 'quick-play']);
    });
});
