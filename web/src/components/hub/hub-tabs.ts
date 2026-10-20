/**
 * ROK-1830 — the hub's tab frame. Core pins Overview, Members and Events
 * first and Resources last (D7-A); a module's tabs sit between them, ordered
 * by their own `order`. A module cannot take the first or the last slot.
 * ROK-1868 A5 — core's Posts tab follows Events once the hub has a post, for
 * every hub kind (`#posts`, deep link `?post=<id>#posts`).
 */
import type { HubCtx, HubModule } from '../../plugins/hub-module';
import { hubCopy } from './hub-copy';

export interface HubTabEntry {
    id: string;
    label: string;
    hidden: boolean;
}

/** Resources joins once it has content, or straight away for an editor; Posts once there is a post. */
export function hubTabs(mod: HubModule | undefined, ctx: HubCtx, showResources: boolean, hasPosts = false): HubTabEntry[] {
    const moduleTabs = [...(mod?.tabs ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((t) => ({ id: t.id, label: t.label, hidden: t.visible ? !t.visible(ctx) : false }));
    return [
        { id: 'overview', label: 'Overview', hidden: false },
        { id: 'members', label: 'Members', hidden: false },
        { id: 'events', label: 'Events', hidden: false },
        { id: 'posts', label: hubCopy(ctx.page.guild.kind).postsTab, hidden: !hasPosts },
        ...moduleTabs,
        { id: 'resources', label: 'Resources', hidden: !showResources },
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
