/**
 * ROK-1912 (epic ROK-1905 H3) — game-scoped hub tabs, on every hub kind.
 *
 * Generalises Pelican's ROK-1831 `registerServerHubGameTab` seam: a plugin calls
 * `PluginHandle.registerHubGameTab(gameSlugs, tab)` at import time and the tab
 * joins the module band of every hub whose `page.guild.gameSlug` is one of
 * `gameSlugs`, whatever the kind, while the registering plugin is active (its
 * endpoints sit behind `PluginActiveGuard`, so an inactive plugin's tab could
 * only ever error). Core merges them in `components/hub/hub-tabs.ts`.
 */
import type { HubTab } from './hub-module';
import { usePluginStore } from '../stores/plugin-store';

interface HubGameTabRegistration {
    pluginSlug: string;
    gameSlugs: readonly string[];
    tab: HubTab;
}

/** Keyed by `pluginSlug:id` — a re-register (HMR) replaces in place, keeping its slot. */
const tabRegistry = new Map<string, HubGameTabRegistration>();

/** @internal Called by `PluginHandle.registerHubGameTab` and the Pelican alias. */
export function addHubGameTab(pluginSlug: string, gameSlugs: readonly string[], tab: HubTab): void {
    tabRegistry.set(`${pluginSlug}:${tab.id}`, { pluginSlug, gameSlugs, tab });
}

/** @internal Called by `clearRegistry`. */
export function clearHubGameTabs(): void {
    tabRegistry.clear();
}

/**
 * Every registered game tab, each wrapped so it is visible only on hubs of its
 * games while its plugin is active (and its own `visible`, if any, agrees). The
 * store is read at call time: the hub page re-renders on `activeSlugs` changes.
 */
export function hubGameTabs(): HubTab[] {
    return [...tabRegistry.values()].map(({ pluginSlug, gameSlugs, tab }) => ({
        ...tab,
        visible: (ctx) => {
            const gameSlug = ctx.page.guild.gameSlug;
            return gameSlug !== undefined
                && gameSlugs.includes(gameSlug)
                && usePluginStore.getState().activeSlugs.has(pluginSlug)
                && (tab.visible?.(ctx) ?? true);
        },
    }));
}
