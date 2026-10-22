/**
 * ROK-1909 (epic ROK-1905 H2) — the Overview cells for plugin game widgets
 * (`PluginHandle.registerHubWidget`). Each one is a `WidgetCard` with a
 * Suspense skeleton around its lazy body and two error boundaries: one inside
 * the card (a throwing body says so in place) and one around the whole cell (a
 * throwing `useVisible` or header action drops just that card). Either way the
 * rest of the Overview keeps rendering. The cell is keyed by guild id, so moving
 * to another hub resets both boundaries and the Suspense.
 */
import type { ReactNode } from 'react';
import type { HubCtx } from '../../plugins/hub-module';
import { gatedHubGameWidgets, type HubWidgetCtx } from '../../plugins/hub-game-widgets';
import { GameWidgetCard, ProbedGameWidget, WidgetBoundary } from './hub-game-widget-card';

/** One Overview cell — the node carries its own column span, so a hidden widget leaves no empty grid item. */
export interface GameWidgetCell {
    key: `plugin:${string}`;
    order: number;
    node: ReactNode;
}

/**
 * The plugin game widgets this viewer may see on this hub, as Overview cells.
 * Gating: plugin active, game and kind match, audience allows, then `useVisible`.
 */
export function gameWidgetCells(ctx: HubCtx, activeSlugs: ReadonlySet<string>): GameWidgetCell[] {
    const gameSlug = ctx.page.guild.gameSlug;
    if (gameSlug === undefined) return [];
    const widgetCtx: HubWidgetCtx = { ...ctx, gameSlug };
    return gatedHubGameWidgets(ctx.page, activeSlugs).map((reg) => {
        const probe = reg.widget.useVisible;
        const card = probe
            ? <ProbedGameWidget reg={reg} ctx={widgetCtx} useVisible={probe} />
            : <GameWidgetCard reg={reg} ctx={widgetCtx} />;
        return {
            key: `plugin:${reg.pluginSlug}:${reg.widget.id}`,
            order: reg.widget.order,
            // Keyed by hub: `GuildPage` is not, so without this hub B would inherit hub A's failed boundary.
            node: <WidgetBoundary key={ctx.page.guild.id} fallback={null}>{card}</WidgetBoundary>,
        };
    });
}
