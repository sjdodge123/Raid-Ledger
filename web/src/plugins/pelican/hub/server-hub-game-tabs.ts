/**
 * ROK-1831 — the original per-game seam of the server hub, now a thin alias of
 * the every-kind registry `PluginHandle.registerHubGameTab` (ROK-1912). A tab
 * registered here shows on any hub whose `page.guild.gameSlug` matches, while
 * `pluginSlug` is active. Core merges the tabs into every hub's frame, so the
 * Pelican module no longer appends them itself.
 */
import type { HubTab } from '../../hub-module';
import { addHubGameTab, hubGameTabs } from '../../hub-game-tabs';

/**
 * @deprecated Use `PluginHandle.registerHubGameTab([gameSlug], tab)`. Adds a tab
 * to hubs of one game, visible while `pluginSlug` is active. The owner is required
 * (ROK-1969 D4) — it used to default to the game slug, i.e. no real plugin.
 */
export function registerServerHubGameTab(gameSlug: string, tab: HubTab, pluginSlug: string): void {
    addHubGameTab(pluginSlug, [gameSlug], tab);
}

/** @deprecated Alias of `hubGameTabs` — every registered game tab, gated per page. */
export function serverHubGameTabs(): HubTab[] {
    return hubGameTabs();
}
