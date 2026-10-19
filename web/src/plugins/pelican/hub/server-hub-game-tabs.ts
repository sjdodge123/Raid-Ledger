/**
 * ROK-1831 — the per-game seam of the server hub. A game plugin (Valheim:
 * ROK-1835/1836) calls `registerServerHubGameTab(gameSlug, tab)` at import time
 * to add a tab to every server hub running that game; `pelicanHubModule` reads
 * them through `serverHubGameTabs`, gated per page by `page.server.gameSlug`.
 * Empty today.
 */
import type { HubTab } from '../../hub-module';

const gameTabs: { gameSlug: string; tab: HubTab }[] = [];

/** Add a tab to server hubs of one game; it shows only where `page.server.gameSlug` matches. */
export function registerServerHubGameTab(gameSlug: string, tab: HubTab): void {
    gameTabs.push({ gameSlug, tab });
}

/** Every registered per-game tab, each wrapped so it is visible only on its own game's hubs. */
export function serverHubGameTabs(): HubTab[] {
    return gameTabs.map(({ gameSlug, tab }) => ({
        ...tab,
        visible: (ctx) => ctx.page.server?.gameSlug === gameSlug && (tab.visible?.(ctx) ?? true),
    }));
}
