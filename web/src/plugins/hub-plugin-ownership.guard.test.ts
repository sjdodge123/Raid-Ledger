/**
 * ROK-1969 §5.3 (W1–W6) — every hub widget and tab belongs to a plugin, and the
 * declarations in `HUB_PLUGIN_MANIFESTS` (what the install sheet lists) match
 * what the plugins really register, in both directions. Discovers every plugin's
 * `register.ts` by glob and checks the set equals what `App.tsx` imports. Adding a hub widget or tab? Declare it
 * under its plugin in `packages/contract/src/plugin-hub-manifests.ts` first.
 */
import { describe, it, expect } from 'vitest';
import { lazy } from 'react';
import { HUB_PLUGIN_MANIFESTS, normaliseHubWidgetPrefs, type PluginHubManifest } from '@raid-ledger/contract';
import {
    collectHubRegistrations, outOfScopeRegistrations, registerImportDrift, undeclaredRegistrations, unregisteredDeclarations,
    type HubRegistration, type Manifests,
} from '../test/hub-plugin-ownership';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getHubGameWidgetRegistrations, type HubGameWidget } from './hub-game-widgets';
import { collectCompanionPrompts, companionPromptDrift, type CompanionPromptRegistration } from '../test/hub-companion-prompt-ownership';
import { claimProviderDrift, collectClaimProviders, type ClaimProviderRegistration } from '../test/hub-claim-provider-ownership';

/** Every plugin folder's `register.ts`, discovered — a new plugin is checked automatically (review M2). */
const PLUGIN_REGISTERS = import.meta.glob('./*/register.ts', { eager: true });
const APP_SOURCE = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');

const live = collectHubRegistrations();
const keys = (regs: readonly HubRegistration[]): string[] => regs.map((r) => `${r.owner}/${r.kind}/${r.id}`);

/** A copy of the manifests with one plugin's list edited — the mutation probes. */
function withManifest(slug: keyof typeof HUB_PLUGIN_MANIFESTS, edit: (m: PluginHubManifest) => PluginHubManifest): Manifests {
    return { ...HUB_PLUGIN_MANIFESTS, [slug]: edit(HUB_PLUGIN_MANIFESTS[slug]) };
}

describe('hub plugin ownership — the scan is not vacuous', () => {
    it('discovers every plugin folder App.tsx registers, and no other', () => {
        expect(Object.keys(PLUGIN_REGISTERS).length).toBeGreaterThanOrEqual(6);
        expect(registerImportDrift(Object.keys(PLUGIN_REGISTERS), APP_SOURCE)).toEqual([]);
    });

    it('names a plugin folder App.tsx does not import, and an App import with no folder', () => {
        const app = "import './plugins/core/register';\nimport './plugins/gone/register';\n";
        expect(registerImportDrift(['./core/register.ts', './bg3/register.ts'], app)).toEqual([
            'plugins/bg3/register.ts exists but App.tsx does not import it',
            'App.tsx imports plugins/gone/register but no ./gone/register.ts was discovered',
        ]);
    });

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

/**
 * ROK-2056 — Companion prompts. Two-way, like W2: a prompt must name an `rlCompanion`
 * requirement of its OWN plugin (inside its gameSlugs), and an `rlCompanion` requirement
 * nobody prompts is reported, not allowed — a Companion collector members are never told
 * about is the gap this story closes. A deliberately silent one needs a guard change.
 */
describe('W7 — every Companion prompt names its own rlCompanion requirement, and back', () => {
    const prompts = collectCompanionPrompts();
    const prompt = (over: Partial<CompanionPromptRegistration>): CompanionPromptRegistration =>
        ({ owner: 'bg3', requirementId: 'upload-saves', alsoCovers: ['companion-screenshots'], games: ['baldurs-gate-3'], ...over });

    it('sees the BG3 and Blizzard prompts, and finds no drift', () => {
        expect(prompts.map((p) => `${p.owner}:${p.requirementId}`))
            .toEqual(expect.arrayContaining(['bg3:upload-saves', 'blizzard:ledgerlink-companion']));
        expect(companionPromptDrift(prompts, HUB_PLUGIN_MANIFESTS)).toEqual([]);
    });

    it('names a prompt whose requirement is missing, lacks rlCompanion, or belongs to another plugin', () => {
        const others = prompts.filter((p) => p.owner !== 'bg3');
        expect(companionPromptDrift([...others, prompt({ requirementId: 'gone' })], HUB_PLUGIN_MANIFESTS)).toEqual([
            'companion prompt bg3:gone names no requirement in HUB_PLUGIN_MANIFESTS.bg3.setup',
            'HUB_PLUGIN_MANIFESTS.bg3.setup requirement "upload-saves" carries rlCompanion but no companion prompt registers it',
        ]);
        expect(companionPromptDrift([...prompts, prompt({ requirementId: 'bind-campaign' })], HUB_PLUGIN_MANIFESTS))
            .toEqual(['companion prompt bg3:bind-campaign names a requirement without rlCompanion']);
        expect(companionPromptDrift([...prompts, prompt({ owner: 'valheim' })], HUB_PLUGIN_MANIFESTS))
            .toEqual(['companion prompt valheim:upload-saves names no requirement in HUB_PLUGIN_MANIFESTS.valheim.setup']);
    });

    it('names a prompt outside its plugin gameSlugs, with no games, or with no manifest', () => {
        const rest = prompts.filter((p) => p.owner !== 'bg3');
        expect(companionPromptDrift([...rest, prompt({ games: ['valheim'] })], HUB_PLUGIN_MANIFESTS))
            .toEqual(['companion prompt bg3:upload-saves targets game "valheim", not in HUB_PLUGIN_MANIFESTS.bg3.gameSlugs']);
        expect(companionPromptDrift([...rest, prompt({ games: [] })], HUB_PLUGIN_MANIFESTS))
            .toEqual(['companion prompt bg3:upload-saves lists no games']);
        expect(companionPromptDrift([...prompts, prompt({ owner: 'ghost' })], HUB_PLUGIN_MANIFESTS))
            .toEqual(['companion prompt ghost:upload-saves has no HUB_PLUGIN_MANIFESTS.ghost']);
    });

    it('holds an alsoCovers id to the same rules, and an uncovered rlCompanion requirement is reported (ROK-1966)', () => {
        const rest = prompts.filter((p) => p.owner !== 'bg3');
        expect(companionPromptDrift([...rest, prompt({ alsoCovers: [] })], HUB_PLUGIN_MANIFESTS)).toEqual([
            'HUB_PLUGIN_MANIFESTS.bg3.setup requirement "companion-screenshots" carries rlCompanion but no companion prompt registers it',
        ]);
        expect(companionPromptDrift([...rest, prompt({ alsoCovers: ['companion-screenshots', 'gone', 'bind-campaign'] })], HUB_PLUGIN_MANIFESTS)).toEqual([
            'companion prompt bg3:upload-saves also covers "gone", which names no requirement in HUB_PLUGIN_MANIFESTS.bg3.setup',
            'companion prompt bg3:upload-saves also covers "bind-campaign", a requirement without rlCompanion',
        ]);
    });

    it('names an rlCompanion requirement no prompt registers', () => {
        const regs = prompts.filter((p) => p.owner !== 'blizzard');
        expect(companionPromptDrift(regs, HUB_PLUGIN_MANIFESTS)).toEqual([
            'HUB_PLUGIN_MANIFESTS.blizzard.setup requirement "ledgerlink-companion" carries rlCompanion but no companion prompt registers it',
        ]);
    });
});

/**
 * ROK-2153 — claim providers. Two-way, like W7: a web claim provider belongs to a plugin
 * whose manifest declares a `claim-provider` behaviour (the api guard pins the api adapter
 * to the same declaration) and stays inside its gameSlugs; a declared `claim-provider`
 * with no web registration is reported — its claim path would never reach a member.
 */
describe('W8 — every claim provider is declared as a claim-provider behaviour, and back', () => {
    const providers = collectClaimProviders();
    const declared = withManifest('valheim', (v) => ({ ...v, behaviours: [...v.behaviours, { id: 'valheim', kind: 'claim-provider', label: 'Claim a character' }] }));
    const provider = (over: Partial<ClaimProviderRegistration>): ClaimProviderRegistration =>
        ({ owner: 'valheim', games: ['valheim'], kinds: ['game_server'], ...over });

    it('finds no drift between the live registry and the manifests', () => {
        expect(claimProviderDrift(providers, HUB_PLUGIN_MANIFESTS)).toEqual([]);
    });

    it('accepts a provider whose plugin declares claim-provider inside its gameSlugs', () => {
        expect(claimProviderDrift([...providers, provider({})], declared)).toEqual([]);
    });

    it('names a provider whose plugin declares no claim-provider, or has no manifest', () => {
        expect(claimProviderDrift([...providers, provider({})], HUB_PLUGIN_MANIFESTS))
            .toEqual(['claim provider valheim is registered but HUB_PLUGIN_MANIFESTS.valheim.behaviours declares no claim-provider']);
        expect(claimProviderDrift([...providers, provider({ owner: 'ghost' })], HUB_PLUGIN_MANIFESTS))
            .toEqual(['claim provider ghost has no HUB_PLUGIN_MANIFESTS.ghost']);
        expect(claimProviderDrift([...providers, provider({ owner: '' })], HUB_PLUGIN_MANIFESTS))
            .toEqual(['claim provider (no owner) has no HUB_PLUGIN_MANIFESTS.(no owner)']);
    });

    it('names a provider outside its plugin gameSlugs, or with no games or kinds', () => {
        expect(claimProviderDrift([...providers, provider({ games: ['enshrouded'] })], declared))
            .toEqual(['claim provider valheim targets game "enshrouded", not in HUB_PLUGIN_MANIFESTS.valheim.gameSlugs']);
        expect(claimProviderDrift([...providers, provider({ games: [], kinds: [] })], declared))
            .toEqual(['claim provider valheim lists no games', 'claim provider valheim lists no hub kinds']);
    });

    it('names a declared claim-provider no web provider registers', () => {
        expect(claimProviderDrift(providers.filter((p) => p.owner !== 'valheim'), declared))
            .toEqual(['HUB_PLUGIN_MANIFESTS.valheim declares a claim-provider behaviour but no web claim provider registers it']);
    });
});
