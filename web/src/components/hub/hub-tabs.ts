/**
 * ROK-1830 — the hub's tab frame. Core pins Overview and Roster first and
 * Resources last (D7-A); a module's tabs sit between them, ordered by their
 * own `order`. A module cannot take the first or the last slot.
 */
import type { HubCtx, HubModule } from '../../plugins/hub-module';

export interface HubTabEntry {
    id: string;
    label: string;
    hidden: boolean;
}

/** Resources joins once it has content, or straight away for an editor. */
export function hubTabs(mod: HubModule | undefined, ctx: HubCtx, showResources: boolean): HubTabEntry[] {
    const moduleTabs = [...(mod?.tabs ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((t) => ({ id: t.id, label: t.label, hidden: t.visible ? !t.visible(ctx) : false }));
    return [
        { id: 'overview', label: 'Overview', hidden: false },
        { id: 'roster', label: 'Roster', hidden: false },
        ...moduleTabs,
        { id: 'resources', label: 'Resources', hidden: !showResources },
    ];
}

export function visibleHubTabIds(tabs: readonly HubTabEntry[]): string[] {
    return tabs.filter((t) => !t.hidden).map((t) => t.id);
}

export function hubTabLabel(tabs: readonly HubTabEntry[], id: string): string {
    return tabs.find((t) => t.id === id)?.label ?? 'Overview';
}
