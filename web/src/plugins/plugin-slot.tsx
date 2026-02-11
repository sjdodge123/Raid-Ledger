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
 * When no active plugin fills the slot, renders the fallback.
 */
export function PluginSlot({ name, context, fallback, className }: PluginSlotProps) {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);

    const registrations = getSlotRegistrations(name)
        .filter((r) => activeSlugs.has(r.pluginSlug));

    if (registrations.length === 0) {
        if (!fallback) return null;
        return className ? <div className={className}>{fallback}</div> : <>{fallback}</>;
    }

    const content = registrations.map((r, i) => (
        <r.component key={`${r.pluginSlug}:${r.slotName}:${i}`} {...context} />
    ));

    return className ? <div className={className}>{content}</div> : <>{content}</>;
}
