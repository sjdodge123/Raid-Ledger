/**
 * ROK-1831 — the per-game seam of the server hub. A game plugin (Valheim:
 * ROK-1835/1836) calls `registerServerHubGameTab(gameSlug, tab)` at import time
 * to add a tab to every server hub running that game; `pelicanHubModule` reads
 * them through `serverHubGameTabs`, gated per page by `page.server.gameSlug`
 * AND by the registering plugin being active (its endpoints sit behind
 * `PluginActiveGuard`, so an inactive plugin's tab could only ever error).
 */
import type { HubTab } from '../../hub-module';
import { usePluginStore } from '../../../stores/plugin-store';

const gameTabs: { gameSlug: string; pluginSlug: string; tab: HubTab }[] = [];

/**
 * Add a tab to server hubs of one game; it shows only where `page.server.gameSlug`
 * matches and while `pluginSlug` (default: the game slug) is an active plugin.
 */
export function registerServerHubGameTab(gameSlug: string, tab: HubTab, pluginSlug: string = gameSlug): void {
    gameTabs.push({ gameSlug, pluginSlug, tab });
}

/**
 * Every registered per-game tab, each wrapped so it is visible only on its own
 * game's hubs while its plugin is active. The store is read at call time: the
 * hub page re-renders on `activeSlugs` changes through `useHubModule`.
 */
export function serverHubGameTabs(): HubTab[] {
    return gameTabs.map(({ gameSlug, pluginSlug, tab }) => ({
        ...tab,
        visible: (ctx) =>
            ctx.page.server?.gameSlug === gameSlug &&
            usePluginStore.getState().activeSlugs.has(pluginSlug) &&
            (tab.visible?.(ctx) ?? true),
    }));
}
