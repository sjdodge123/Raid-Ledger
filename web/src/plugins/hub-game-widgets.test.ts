/** ROK-1909 — the game-scoped hub widget registry and its pure gating. */
import { describe, it, expect, beforeEach } from 'vitest';
import { lazy, type ComponentType } from 'react';
import type { GuildPage } from '@raid-ledger/contract';
import { clearRegistry, registerPlugin } from './plugin-registry';
import {
    audienceAllows, getHubGameWidgetRegistrations, gatedHubGameWidgets, type HubGameWidget, type HubWidgetCtx,
} from './hub-game-widgets';

const Empty: ComponentType<HubWidgetCtx> = () => null;
const LazyEmpty = lazy(() => Promise.resolve({ default: Empty }));

function widget(over: Partial<HubGameWidget> = {}): HubGameWidget {
    return { id: 'w', title: 'W', games: ['forever'], order: 45, audience: 'everyone', component: LazyEmpty, ...over };
}

function page(over: { gameSlug?: string; kind?: GuildPage['guild']['kind']; role?: GuildPage['viewer']['role']; canEdit?: boolean } = {}): GuildPage {
    const role = over.role ?? 'member';
    return {
        guild: {
            id: 7, gameId: 1, kind: over.kind ?? 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null,
            faction: null, memberCount: 1, lastSnapshotAt: null, ...(over.gameSlug === undefined ? {} : { gameSlug: over.gameSlug }),
        },
        importedBy: null,
        viewer: { role, canEdit: over.canEdit ?? false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

const ACTIVE = new Set(['wow']);

beforeEach(() => clearRegistry());

describe('registerHubWidget', () => {
    it('replaces a re-registered widget by (pluginSlug, id) — HMR', () => {
        const handle = registerPlugin('wow', { icon: '/x.png', color: 'blue', label: 'WoW' });
        handle.registerHubWidget(widget({ title: 'Old' }));
        handle.registerHubWidget(widget({ title: 'New' }));
        handle.registerHubWidget(widget({ id: 'other' }));
        const titles = getHubGameWidgetRegistrations().map((r) => `${r.pluginSlug}:${r.widget.id}:${r.widget.title}`);
        expect(titles).toEqual(['wow:w:New', 'wow:other:W']);
    });

    it('keeps two plugins with the same widget id apart', () => {
        registerPlugin('wow', { icon: '/x.png', color: 'blue', label: 'WoW' }).registerHubWidget(widget());
        registerPlugin('other', { icon: '/x.png', color: 'blue', label: 'O' }).registerHubWidget(widget());
        expect(getHubGameWidgetRegistrations()).toHaveLength(2);
    });

    it('clearRegistry empties it', () => {
        registerPlugin('wow', { icon: '/x.png', color: 'blue', label: 'WoW' }).registerHubWidget(widget());
        clearRegistry();
        expect(getHubGameWidgetRegistrations()).toHaveLength(0);
    });
});

describe('gatedHubGameWidgets', () => {
    const ids = (p: GuildPage, active: ReadonlySet<string> = ACTIVE): string[] =>
        gatedHubGameWidgets(p, active).map((r) => r.widget.id);

    beforeEach(() => {
        registerPlugin('wow', { icon: '/x.png', color: 'blue', label: 'WoW' }).registerHubWidget(widget());
    });

    it('shows a widget for its game on an active plugin', () => {
        expect(ids(page({ gameSlug: 'forever' }))).toEqual(['w']);
    });

    it('hides it while the plugin is inactive', () => {
        expect(ids(page({ gameSlug: 'forever' }), new Set())).toEqual([]);
    });

    it('hides it on another game, and on a page with no gameSlug', () => {
        expect(ids(page({ gameSlug: 'classic' }))).toEqual([]);
        expect(ids(page())).toEqual([]);
    });

    it('defaults to every kind, and honours an explicit kinds list', () => {
        expect(ids(page({ gameSlug: 'forever', kind: 'game_community' }))).toEqual(['w']);
        clearRegistry();
        registerPlugin('wow', { icon: '/x.png', color: 'blue', label: 'WoW' })
            .registerHubWidget(widget({ kinds: ['game_server'] }));
        expect(ids(page({ gameSlug: 'forever', kind: 'wow_guild' }))).toEqual([]);
        expect(ids(page({ gameSlug: 'forever', kind: 'game_server' }))).toEqual(['w']);
    });

    it('shows a core widget with no active set at all — core is always on (ROK-1969 D3)', () => {
        registerPlugin('core', { icon: 'x', color: 'c', label: 'Core' }).registerHubWidget(widget({ id: 'shared' }));
        expect(ids(page({ gameSlug: 'forever' }), new Set())).toEqual(['shared']);
    });

    it('a widget that omits `games` matches every game, but never a page with no gameSlug (ROK-1969 §5.2)', () => {
        const { games: _omit, ...rest } = widget({ id: 'any' });
        registerPlugin('wow', { icon: '/x.png', color: 'blue', label: 'WoW' }).registerHubWidget(rest);
        expect(ids(page({ gameSlug: 'minecraft' }))).toEqual(['any']);
        expect(ids(page())).toEqual([]);
    });

    it('sorts by order', () => {
        registerPlugin('wow', { icon: '/x.png', color: 'blue', label: 'WoW' }).registerHubWidget(widget({ id: 'early', order: 5 }));
        expect(ids(page({ gameSlug: 'forever' }))).toEqual(['early', 'w']);
    });
});

describe('audienceAllows', () => {
    it('everyone: visitors too', () => {
        expect(audienceAllows('everyone', page({ role: 'visitor' }).viewer)).toBe(true);
    });

    it('members: a member yes, a visitor no', () => {
        expect(audienceAllows('members', page({ role: 'member' }).viewer)).toBe(true);
        expect(audienceAllows('members', page({ role: 'visitor' }).viewer)).toBe(false);
    });

    it('editors: canEdit only', () => {
        expect(audienceAllows('editors', page({ role: 'member' }).viewer)).toBe(false);
        expect(audienceAllows('editors', page({ role: 'officer', canEdit: true }).viewer)).toBe(true);
    });
});
