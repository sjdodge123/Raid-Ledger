/**
 * ROK-1909 (epic ROK-1905 H2) — game-scoped hub Overview widgets.
 *
 * A `HubModule` belongs to the plugin that OWNS a hub kind, so until now only
 * that plugin could put cards on the Overview. This registry sits beside it —
 * the same way calendar layers and identity providers sit beside slots — so any
 * plugin can add a widget to every hub of its game, whatever the kind. Core
 * renders the chrome (`WidgetCard` + Suspense + error boundary) in
 * `components/hub/hub-widget-cells.tsx`; v1 order is fixed by `order`.
 */
import type { ComponentType, LazyExoticComponent } from 'react';
import type { GuildPage } from '@raid-ledger/contract';
import type { HubCtx, HubKind } from './hub-module';

/** Who sees a widget: anyone who can open the hub, members (not visitors), or editors (`canEdit`). */
export type HubWidgetAudience = 'everyone' | 'members' | 'editors';

/** What a game widget receives: the hub context plus the matched game slug. */
export type HubWidgetCtx = HubCtx & { gameSlug: string };

/**
 * A plugin's game-scoped hub Overview card. `audience` is a client-side display
 * filter; members-only data endpoints MUST also enforce access server-side.
 */
export interface HubGameWidget {
    /** Unique per plugin; the card's DOM id is `hub-widget-<pluginSlug>-<id>`. */
    id: string;
    /** Card heading — core draws the `WidgetCard` chrome. */
    title: string;
    /** Game slugs, matched against `page.guild.gameSlug`. */
    games: readonly string[];
    /** Hub kinds it may appear on. Omitted = every kind. */
    kinds?: readonly HubKind[];
    /** Merged with the core cells (10/20/30/40/70) and the module's widgets. */
    order: number;
    /** Columns at ≥1024px. 3 clamps to 2 at ≥768px; everything is 1 on phone. Default 1. */
    span?: 1 | 2 | 3;
    /**
     * Audience is a client-side display filter; members-only data endpoints MUST
     * also enforce access server-side.
     */
    audience: HubWidgetAudience;
    /** Lazy, so a plugin's `register.ts` stays light (app-entry budget). */
    component: LazyExoticComponent<ComponentType<HubWidgetCtx>>;
    /** Optional header control ("See all", a tab jump). */
    action?: ComponentType<HubWidgetCtx>;
    /** Hook-capable probe (may call queries); `false` hides the card. Omitted = always shown. */
    useVisible?: (ctx: HubWidgetCtx) => boolean;
}

export interface HubGameWidgetRegistration {
    pluginSlug: string;
    widget: HubGameWidget;
}

/** Keyed by `pluginSlug:id` — a re-register (HMR) replaces in place. */
const widgetRegistry = new Map<string, HubGameWidgetRegistration>();

/** @internal Called by `PluginHandle.registerHubWidget`. */
export function addHubGameWidget(pluginSlug: string, widget: HubGameWidget): void {
    widgetRegistry.set(`${pluginSlug}:${widget.id}`, { pluginSlug, widget });
}

/** Every registered game widget, regardless of plugin status — callers filter. */
export function getHubGameWidgetRegistrations(): readonly HubGameWidgetRegistration[] {
    return [...widgetRegistry.values()];
}

/** @internal Called by `clearRegistry`. */
export function clearHubGameWidgets(): void {
    widgetRegistry.clear();
}

/** Whether the viewer is in the widget's audience. */
export function audienceAllows(audience: HubWidgetAudience, viewer: GuildPage['viewer']): boolean {
    if (audience === 'editors') return viewer.canEdit;
    if (audience === 'members') return viewer.role !== 'visitor';
    return true;
}

function matches(r: HubGameWidgetRegistration, page: GuildPage, active: ReadonlySet<string>, gameSlug: string): boolean {
    const { widget } = r;
    return active.has(r.pluginSlug)
        && widget.games.includes(gameSlug)
        && (widget.kinds === undefined || widget.kinds.includes(page.guild.kind))
        && audienceAllows(widget.audience, page.viewer);
}

/**
 * The widgets this hub may show, sorted by `order`: plugin active, game and
 * kind match, viewer in audience. `useVisible` runs later, inside each cell.
 */
export function gatedHubGameWidgets(page: GuildPage, active: ReadonlySet<string>): readonly HubGameWidgetRegistration[] {
    const gameSlug = page.guild.gameSlug;
    if (gameSlug === undefined) return [];
    return getHubGameWidgetRegistrations()
        .filter((r) => matches(r, page, active, gameSlug))
        .sort((a, b) => a.widget.order - b.widget.order);
}
