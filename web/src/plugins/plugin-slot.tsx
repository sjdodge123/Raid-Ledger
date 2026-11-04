import type { ReactNode } from 'react';
import { usePluginStore } from '../stores/plugin-store';
import { getSlotRegistrations, type PluginSlotName } from './plugin-registry';

interface PluginSlotProps {
    name: PluginSlotName;
    context?: Record<string, unknown>;
    fallback?: ReactNode;
    className?: string;
}

/**
 * Renders plugin-provided components for a named slot.
 * Components are filtered by active plugin status and stacked by priority.
 * Plugin badges are shown only on admin UI cards, not on user-facing slots (ROK-302).
 * When no active plugin fills the slot, renders the fallback.
 * A `context.pluginSlug` scopes the slot to that one plugin: every plugin fills
 * slots like `admin-settings:plugin-content` and renders null for a foreign
 * slug, so without the scope "some plugin registered" would hide the fallback
 * while nothing renders.
 */
export function PluginSlot({ name, context, fallback, className }: PluginSlotProps) {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);

    const scopedSlug = typeof context?.pluginSlug === 'string' ? context.pluginSlug : null;
    const registrations = getSlotRegistrations(name)
        .filter((r) => activeSlugs.has(r.pluginSlug))
        .filter((r) => scopedSlug === null || r.pluginSlug === scopedSlug);

    if (registrations.length === 0) {
        if (!fallback) return null;
        return className ? <div className={className}>{fallback}</div> : <>{fallback}</>;
    }

    const content = registrations.map((r, i) => (
        <r.component key={`${r.pluginSlug}:${r.slotName}:${i}`} {...context} />
    ));

    return className ? <div className={className}>{content}</div> : <>{content}</>;
}
