import type { ComponentType } from 'react';

/** All plugin slot names — each corresponds to a page location */
export type PluginSlotName =
    | 'character-detail:sections'
    | 'character-detail:header-badges'
    | 'character-create:import-form'
    | 'character-create:inline-import'
    | 'event-create:content-browser'
    | 'event-detail:content-sections'
    | 'event-detail:signup-warnings'
    | 'admin-settings:integration-cards'
    | 'admin-settings:plugin-content'
    | 'profile:character-actions';

export interface PluginBadgeMeta {
    icon: string;
    color: string;
    label: string;
}

export interface SlotRegistration {
    pluginSlug: string;
    slotName: PluginSlotName;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: ComponentType<any>;
    priority: number;
}

/** Module-level registry — populated at import time by plugin register files */
const registry: SlotRegistration[] = [];

/** Badge metadata keyed by plugin slug */
const badgeRegistry = new Map<string, PluginBadgeMeta>();

export function registerPlugin(slug: string, badge: PluginBadgeMeta): void {
    badgeRegistry.set(slug, badge);
}

export function getPluginBadge(slug: string): PluginBadgeMeta | undefined {
    return badgeRegistry.get(slug);
}

export function registerSlotComponent(registration: SlotRegistration): void {
    // De-duplicate: replace existing registration for the same plugin+slot
    // to prevent HMR from accumulating duplicate entries (ROK-206)
    const existingIndex = registry.findIndex(
        (r) =>
            r.pluginSlug === registration.pluginSlug &&
            r.slotName === registration.slotName,
    );
    if (existingIndex !== -1) {
        registry[existingIndex] = registration;
    } else {
        registry.push(registration);
    }
    registry.sort((a, b) => a.priority - b.priority);
}

export function getSlotRegistrations(slotName: PluginSlotName): readonly SlotRegistration[] {
    return registry.filter((r) => r.slotName === slotName);
}

export function clearRegistry(): void {
    registry.length = 0;
    badgeRegistry.clear();
}
