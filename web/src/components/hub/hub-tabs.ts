/**
 * ROK-1830 — the hub's tab frame. Core pins the band Overview, Members,
 * Events, Resources first; a module's tabs follow it, ordered by their own
 * `order`. A module cannot take the first slot or break up the core band.
 * ROK-1876 (operator ruling 2026-10-21) moved Resources from last (D7-A) to
 * right after Events on every hub kind, so a long module band never pushes
 * it several swipes away on a phone.
 * ROK-1868 A5 — core's Posts tab joins the core band once the hub has a post,
 * for every hub kind (`#posts`, deep link `?post=<id>#posts`); it follows
 * Resources so Resources keeps its slot right after Events (ROK-1876).
 */
import type { HubCtx, HubModule, HubTab } from '../../plugins/hub-module';
import { hubGameTabs } from '../../plugins/hub-game-tabs';
import { hubCopy } from './hub-copy';

export interface HubTabEntry {
    id: string;
    label: string;
    hidden: boolean;
}

/**
 * The post routes (`GET /guilds/:id/posts*`) are member-only; an overview-only
 * visitor reads the latest post in place on the Overview card instead, so a
 * `?post=` link from one falls back to Overview rather than a 403 panel.
 */
export function canOpenHubPosts(ctx: HubCtx): boolean {
    return ctx.page.viewer.role !== 'visitor';
}

/** Core's tab ids (`hubTabs` below); a module or game tab may not reuse one. */
const CORE_TAB_IDS: readonly string[] = ['overview', 'members', 'events', 'resources', 'posts'];

/**
 * The module band: the kind module's own tabs plus every plugin's game tabs
 * (ROK-1912 `registerHubGameTab`), each game tab gated on `page.guild.gameSlug`.
 * A game tab whose id core, the module or an earlier game tab already uses is
 * dropped (dev warning) — a duplicate id would mean a duplicate React key and
 * the wrong panel behind the `#<id>` hash.
 */
export function hubModuleTabs(mod: HubModule | undefined): HubTab[] {
    const own = mod?.tabs ?? [];
    const taken = new Set([...CORE_TAB_IDS, ...own.map((t) => t.id)]);
    const games = hubGameTabs().filter((t) => {
        if (!taken.has(t.id)) {
            taken.add(t.id);
            return true;
        }
        if (import.meta.env.DEV) console.warn(`[hub] game tab "${t.id}" collides with an existing hub tab id; dropped`);
        return false;
    });
    return [...own, ...games];
}

/** Resources joins once it has content, or straight away for an editor; Posts once there is a post and the viewer may open it. */
export function hubTabs(mod: HubModule | undefined, ctx: HubCtx, showResources: boolean, hasPosts = false): HubTabEntry[] {
    const moduleTabs = hubModuleTabs(mod)
        .sort((a, b) => a.order - b.order)
        .map((t) => ({ id: t.id, label: t.label, hidden: t.visible ? !t.visible(ctx) : false }));
    return [
        { id: 'overview', label: 'Overview', hidden: false },
        { id: 'members', label: 'Members', hidden: false },
        { id: 'events', label: 'Events', hidden: false },
        { id: 'resources', label: 'Resources', hidden: !showResources },
        { id: 'posts', label: hubCopy(ctx.page.guild.kind).postsTab, hidden: !hasPosts || !canOpenHubPosts(ctx) },
        ...moduleTabs,
    ];
}

/**
 * Hashes that are no longer tab ids, mapped onto the tab that replaced them.
 * `#roster` predates the D7-A rename to Members (ROK-1830) and is kept so
 * links shared from the old page still open the right tab.
 */
export const HUB_TAB_HASH_ALIASES: Readonly<Record<string, string>> = { roster: 'members' };

export function visibleHubTabIds(tabs: readonly HubTabEntry[]): string[] {
    return tabs.filter((t) => !t.hidden).map((t) => t.id);
}

export function hubTabLabel(tabs: readonly HubTabEntry[], id: string): string {
    return tabs.find((t) => t.id === id)?.label ?? 'Overview';
}
