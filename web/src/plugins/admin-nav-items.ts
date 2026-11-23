/**
 * Plugin Admin → General rows — the generic host API a plugin uses to add rows
 * to the admin General section (after Logs) for its own pages under
 * `/admin/settings/general/…` (ROK-2099). Plugins declare through
 * `PluginHandle.registerAdminGeneralNavItems`; core (the admin sidebar and the
 * phone More drawer) reads `useAdminGeneralNavItems()`, which returns only the
 * rows of ACTIVE declaring plugins. Core never imports the plugin.
 */
import { useMemo } from 'react';
import type { NavItem } from '../components/admin/admin-nav-data';
import { usePluginStore } from '../stores/plugin-store';

/** Rows keyed by declaring plugin slug — one list per plugin (HMR replaces). */
const rows = new Map<string, readonly NavItem[]>();

/** @internal Called by `PluginHandle.registerAdminGeneralNavItems`. */
export function addAdminGeneralNavItems(pluginSlug: string, items: readonly NavItem[]): void {
    rows.set(pluginSlug, items);
}

/** @internal Called by `clearRegistry` (tests). */
export function clearAdminGeneralNavItems(): void {
    rows.clear();
}

/** The General-section rows of every active plugin, in registration order; empty when none. */
export function useAdminGeneralNavItems(): readonly NavItem[] {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);
    return useMemo(
        () => [...rows].flatMap(([pluginSlug, items]) => (activeSlugs.has(pluginSlug) ? items : [])),
        [activeSlugs],
    );
}
