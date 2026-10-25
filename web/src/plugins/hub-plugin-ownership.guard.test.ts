/**
 * ROK-1969 §5.3 (W1–W6) — every hub widget and tab belongs to a plugin, and the
 * declarations in `HUB_PLUGIN_MANIFESTS` (what the install sheet lists) match
 * what the plugins really register, in both directions. Imports every plugin's
 * `register.ts` the way `App.tsx` does. Adding a hub widget or tab? Declare it
 * under its plugin in `packages/contract/src/plugin-hub-manifests.ts` first.
 */
import { describe, it, expect } from 'vitest';
import { lazy } from 'react';
import { HUB_PLUGIN_MANIFESTS, normaliseHubWidgetPrefs, type PluginHubManifest } from '@raid-ledger/contract';
import {
    collectHubRegistrations, outOfScopeRegistrations, undeclaredRegistrations, unregisteredDeclarations,
    type HubRegistration, type Manifests,
} from '../test/hub-plugin-ownership';
import { getHubGameWidgetRegistrations, type HubGameWidget } from './hub-game-widgets';
import './core/register';
import './wow/register';
import './discord/register';
import './ai/register';
import './pelican/register';
import './valheim/register';

const live = collectHubRegistrations();
const keys = (regs: readonly HubRegistration[]): string[] => regs.map((r) => `${r.owner}/${r.kind}/${r.id}`);

/** A copy of the manifests with one plugin's list edited — the mutation probes. */
function withManifest(slug: keyof typeof HUB_PLUGIN_MANIFESTS, edit: (m: PluginHubManifest) => PluginHubManifest): Manifests {
    return { ...HUB_PLUGIN_MANIFESTS, [slug]: edit(HUB_PLUGIN_MANIFESTS[slug]) };
}

describe('hub plugin ownership — the scan is not vacuous', () => {
    it('sees the core band, core tabs, plugin widgets, module widgets and game tabs', () => {
        expect(keys(live)).toEqual(expect.arrayContaining([
            'core/widget/gm-post', 'core/tab/overview', 'core/widget/gallery', 'valheim/widget/deaths',
            'blizzard/widget/role-composition', 'pelican/widget/server-hours', 'valheim/tab/map', 'blizzard/tab/raids',
        ]));
    });
});

describe('W1 — every widget registration is declared under its owner', () => {
    it('finds no undeclared registration', () => {
        expect(undeclaredRegistrations(live, HUB_PLUGIN_MANIFESTS)).toEqual([]);
    });

    it('names a registration whose declaration was removed', () => {
        const m = withManifest('valheim', (v) => ({ ...v, widgets: v.widgets.filter((w) => w.id !== 'deaths') }));
        expect(undeclaredRegistrations(live, m)).toEqual(['plugin:valheim:deaths is registered but not declared in HUB_PLUGIN_MANIFESTS.valheim']);
    });

    it('names a registration whose declared title drifted', () => {
        const m = withManifest('core', (c) => ({ ...c, widgets: c.widgets.map((w) => (w.id === 'gallery' ? { ...w, title: 'Photos' } : w)) }));
        expect(undeclaredRegistrations(live, m)).toEqual(['plugin:core:gallery is registered as "Gallery" but declared as "Photos"']);
    });
});

describe('W2 — every declared widget and tab is registered (two-way, D8)', () => {
    it('finds no declaration without a registration', () => {
        expect(unregisteredDeclarations(live, HUB_PLUGIN_MANIFESTS)).toEqual([]);
    });

    it('names a declaration whose registration was removed', () => {
        const regs = live.filter((r) => !(r.owner === 'blizzard' && r.id === 'members-summary'));
        expect(unregisteredDeclarations(regs, HUB_PLUGIN_MANIFESTS))
            .toEqual(['HUB_PLUGIN_MANIFESTS.blizzard declares widget "members-summary" (module) but nothing registers it']);
    });

    it('checks core bare ids against CORE_BAND_IDS', () => {
        const regs = live.filter((r) => !(r.owner === 'core' && r.id === 'attendance'));
        expect(unregisteredDeclarations(regs, HUB_PLUGIN_MANIFESTS))
            .toEqual(['HUB_PLUGIN_MANIFESTS.core declares widget "attendance" (bare) but nothing registers it']);
    });
});

describe('W3 — every tab registration (game tabs + module tabs) is declared', () => {
    it('names a tab whose declaration was removed', () => {
        const m = withManifest('valheim', (v) => ({ ...v, tabs: v.tabs.filter((t) => t.id !== 'planner') }));
        expect(undeclaredRegistrations(live, m)).toEqual(['tab valheim:planner is registered but not declared in HUB_PLUGIN_MANIFESTS.valheim']);
    });

    it('names a module tab whose declaration was removed', () => {
        const m = withManifest('pelican', (p) => ({ ...p, tabs: [] }));
        expect(unregisteredDeclarations(live, m)).toEqual([]);
        expect(undeclaredRegistrations(live, m)).toEqual(['tab pelican:quick-play is registered but not declared in HUB_PLUGIN_MANIFESTS.pelican']);
    });
});

describe('W4 — game scope: a non-core widget lists games inside its gameSlugs', () => {
    it('finds no out-of-scope widget or game tab', () => {
        expect(outOfScopeRegistrations(live, HUB_PLUGIN_MANIFESTS)).toEqual([]);
    });

    it('names a widget whose game is outside the plugin gameSlugs', () => {
        const m = withManifest('valheim', (v) => ({ ...v, gameSlugs: ['enshrouded'] }));
        expect(outOfScopeRegistrations(live, m)).toEqual(expect.arrayContaining([
            'plugin:valheim:deaths targets game "valheim", not in HUB_PLUGIN_MANIFESTS.valheim.gameSlugs',
            'tab valheim:map targets game "valheim", not in HUB_PLUGIN_MANIFESTS.valheim.gameSlugs',
        ]));
    });

    it('names a non-core widget with no games, and lets a core one omit them', () => {
        const regs: HubRegistration[] = [
            { owner: 'valheim', kind: 'widget', layoutKey: 'plugin', id: 'deaths', title: 'Deaths' },
            { owner: 'core', kind: 'widget', layoutKey: 'plugin', id: 'gallery', title: 'Gallery' },
        ];
        expect(outOfScopeRegistrations(regs, HUB_PLUGIN_MANIFESTS)).toEqual(['plugin:valheim:deaths lists no games — only core widgets may omit them']);
    });
});

describe('W5 — an unowned registration fails check 1', () => {
    const widget: HubGameWidget = { id: 'stray', title: 'Stray', games: ['valheim'], order: 1, audience: 'everyone', component: lazy(() => Promise.resolve({ default: () => null })) };
    const stray = (owner: string): HubRegistration => ({ owner, kind: 'widget', layoutKey: 'plugin', id: widget.id, title: widget.title });

    it('reports an empty owner and an unknown owner by key', () => {
        expect(undeclaredRegistrations([...live, stray(''), stray('ghost')], HUB_PLUGIN_MANIFESTS)).toEqual([
            'plugin::stray is registered but not declared in HUB_PLUGIN_MANIFESTS.(no owner)',
            'plugin:ghost:stray is registered but not declared in HUB_PLUGIN_MANIFESTS.ghost',
        ]);
    });

    it('the live registry carries no unowned widget', () => {
        expect(getHubGameWidgetRegistrations().filter((r) => r.pluginSlug === '').map((r) => r.widget.id)).toEqual([]);
    });
});

describe('W6 — the Gallery alias', () => {
    it('maps the old Valheim Gallery id to the Core one and collapses duplicates', () => {
        const prefs = { order: ['plugin:valheim:gallery', 'events', 'plugin:core:gallery'], hidden: [], added: [], config: {} };
        expect(normaliseHubWidgetPrefs(prefs).order).toEqual(['plugin:core:gallery', 'events']);
    });
});
