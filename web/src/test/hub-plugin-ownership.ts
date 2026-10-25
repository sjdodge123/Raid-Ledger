/**
 * ROK-1969 §5.3 — pure checks behind `plugins/hub-plugin-ownership.guard.test.ts`:
 * every live hub registration against `HUB_PLUGIN_MANIFESTS`, in both directions.
 * Each takes its inputs, so the guard can mutate copies to prove it bites.
 */
import { CORE_PLUGIN_ID, type HubWidgetLayoutKey, type PluginHubManifest } from '@raid-ledger/contract';
import { getHubGameWidgetRegistrations } from '../plugins/hub-game-widgets';
import { getHubGameTabRegistrations } from '../plugins/hub-game-tabs';
import { getHubModuleRegistrations } from '../plugins/plugin-registry';
import type { HubModuleRegistration } from '../plugins/hub-module';
import { CORE_BAND_IDS, humaniseWidgetId } from '../components/hub/layout/hub-widget-catalog';
import { CORE_TAB_IDS } from '../components/hub/hub-tabs';
import { communityHubModule } from '../components/hub/community/community-hub-module';

/** One registered hub widget or tab, flattened from whichever registry holds it. */
export interface HubRegistration {
    owner: string;
    kind: 'widget' | 'tab';
    /** Widgets only: which key family it renders under. */
    layoutKey?: HubWidgetLayoutKey;
    id: string;
    /** Widget title / tab label; omitted where core computes it per hub kind. */
    title?: string;
    /** Game scope (`games` / tab `gameSlugs`); omitted = every game. */
    games?: readonly string[];
}

export type Manifests = Readonly<Record<string, PluginHubManifest>>;

function moduleRegistrations({ pluginSlug: owner, module }: HubModuleRegistration): HubRegistration[] {
    return [
        ...module.overviewWidgets.map((w) => ({ owner, kind: 'widget' as const, layoutKey: 'module' as const, id: w.id, title: w.title ?? humaniseWidgetId(w.id) })),
        ...module.tabs.map((t) => ({ owner, kind: 'tab' as const, id: t.id, title: t.label })),
    ];
}

/** Every hub widget and tab registered right now, with its owner (the core band and the core module included). */
export function collectHubRegistrations(): HubRegistration[] {
    const core = CORE_PLUGIN_ID;
    return [
        ...CORE_BAND_IDS.map((id) => ({ owner: core, kind: 'widget' as const, layoutKey: 'bare' as const, id })),
        ...CORE_TAB_IDS.map((id) => ({ owner: core, kind: 'tab' as const, id })),
        ...getHubGameWidgetRegistrations().map(({ pluginSlug, widget }) => ({
            owner: pluginSlug, kind: 'widget' as const, layoutKey: 'plugin' as const, id: widget.id, title: widget.title, ...(widget.games === undefined ? {} : { games: widget.games }),
        })),
        ...getHubGameTabRegistrations().map(({ pluginSlug, gameSlugs, tab }) => ({ owner: pluginSlug, kind: 'tab' as const, id: tab.id, title: tab.label, games: gameSlugs })),
        ...[...getHubModuleRegistrations(), { pluginSlug: core, module: communityHubModule }].flatMap(moduleRegistrations),
    ];
}

/** `plugin:valheim:deaths`, `module:raids`, `gm-post`, `tab valheim:map` — how a failure names a registration. */
export function registrationKey(r: Pick<HubRegistration, 'owner' | 'kind' | 'layoutKey' | 'id'>): string {
    if (r.kind === 'tab') return `tab ${r.owner}:${r.id}`;
    if (r.layoutKey === 'plugin') return `plugin:${r.owner}:${r.id}`;
    return r.layoutKey === 'module' ? `module:${r.id} (${r.owner})` : r.id;
}

function declarationOf(r: HubRegistration, manifests: Manifests): { title: string } | undefined {
    const m = new Map(Object.entries(manifests)).get(r.owner);
    if (r.kind === 'tab') return m?.tabs.map((t) => ({ title: t.label, id: t.id })).find((t) => t.id === r.id);
    return m?.widgets.find((w) => w.id === r.id && w.layoutKey === r.layoutKey);
}

/** Checks 1 + 3: every registration is declared under its owner, with the same title/label. */
export function undeclaredRegistrations(regs: readonly HubRegistration[], manifests: Manifests): string[] {
    return regs.flatMap((r) => {
        const decl = declarationOf(r, manifests);
        const key = registrationKey(r);
        if (decl === undefined) return [`${key} is registered but not declared in HUB_PLUGIN_MANIFESTS.${r.owner || '(no owner)'}`];
        if (r.title !== undefined && r.title !== decl.title) return [`${key} is registered as "${r.title}" but declared as "${decl.title}"`];
        return [];
    });
}

/** Check 2 (two-way, D8): every declared widget and tab is registered by its plugin. */
export function unregisteredDeclarations(regs: readonly HubRegistration[], manifests: Manifests): string[] {
    const live = new Set(regs.map(registrationKey));
    return Object.entries(manifests).flatMap(([owner, m]) => [
        ...m.widgets.filter((w) => !live.has(registrationKey({ owner, kind: 'widget', layoutKey: w.layoutKey, id: w.id })))
            .map((w) => `HUB_PLUGIN_MANIFESTS.${owner} declares widget "${w.id}" (${w.layoutKey}) but nothing registers it`),
        ...m.tabs.filter((t) => !live.has(registrationKey({ owner, kind: 'tab', id: t.id })))
            .map((t) => `HUB_PLUGIN_MANIFESTS.${owner} declares tab "${t.id}" but nothing registers it`),
    ]);
}

/** Check 4: a non-core game widget or game tab names its games, all inside its plugin's `gameSlugs`. */
export function outOfScopeRegistrations(regs: readonly HubRegistration[], manifests: Manifests): string[] {
    const scoped = regs.filter((r) => r.owner !== CORE_PLUGIN_ID && (r.layoutKey === 'plugin' || (r.kind === 'tab' && r.games !== undefined)));
    return scoped.flatMap((r) => {
        const key = registrationKey(r);
        if (r.games === undefined || r.games.length === 0) return [`${key} lists no games — only core widgets may omit them`];
        const allowed = new Map(Object.entries(manifests)).get(r.owner)?.gameSlugs ?? [];
        return r.games.filter((g) => !allowed.includes(g))
            .map((g) => `${key} targets game "${g}", not in HUB_PLUGIN_MANIFESTS.${r.owner}.gameSlugs`);
    });
}
