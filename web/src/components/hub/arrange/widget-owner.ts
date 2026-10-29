/**
 * ROK-1918 L6 — who a widget comes from, shown muted on each arrange row
 * (mockup frame 1: "Core", "WoW: Forever", "Valheim"). Derived from the
 * widget id here, in the lazy arrange chunk, rather than stored on every
 * catalog entry: the catalog ships in `hub-page`, whose gzip budget has
 * ~0.1 KB left, and the id prefix already says where a widget came from.
 *
 * - `plugin:<slug>:<id>` → that plugin's badge label.
 * - `module:<id>` → the plugin that registered this hub kind's module, or
 *   "Core" for the core community module.
 * - core ids and `generic:*` (L7) → "Core".
 */
import { getHubModuleRegistrations, getPluginBadge } from '../../../plugins/plugin-registry';

export const CORE_OWNER = 'Core';

/** "World of Warcraft Plugin" → "World of Warcraft"; an unregistered slug falls back to the slug itself. */
export function pluginOwnerLabel(slug: string): string {
    const label = getPluginBadge(slug)?.label;
    if (label === undefined) return slug.charAt(0).toUpperCase() + slug.slice(1);
    return label.replace(/\s+plugin$/i, '');
}

export function widgetOwner(id: string, kind: string): string {
    if (id.startsWith('plugin:')) {
        const slug = id.split(':')[1];
        return slug ? pluginOwnerLabel(slug) : CORE_OWNER;
    }
    if (id.startsWith('module:')) {
        const reg = getHubModuleRegistrations().find((r) => r.module.kind === kind);
        return reg ? pluginOwnerLabel(reg.pluginSlug) : CORE_OWNER;
    }
    return CORE_OWNER;
}
