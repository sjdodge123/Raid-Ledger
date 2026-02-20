import type { ReactNode } from 'react';
import { usePluginStore } from '../stores/plugin-store';
import { getSlotRegistrations, getPluginBadge, type PluginSlotName } from './plugin-registry';
import { PluginBadge } from '../components/ui/plugin-badge';

interface PluginSlotProps {
    name: PluginSlotName;
    context?: Record<string, unknown>;
    fallback?: ReactNode;
    className?: string;
}

/**
 * Renders plugin-provided components for a named slot.
 * Components are filtered by active plugin status and stacked by priority.
 * Each plugin component is automatically wrapped with its plugin badge (ROK-302).
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

    const content = registrations.map((r, i) => {
        const badge = getPluginBadge(r.pluginSlug);
        return (
            <div key={`${r.pluginSlug}:${r.slotName}:${i}`} className="relative">
                {badge && (
                    <div className="absolute top-1 right-1 z-10">
                        <PluginBadge icon={badge.icon} color={badge.color} label={badge.label} />
                    </div>
                )}
                <r.component {...context} />
            </div>
        );
    });

    return className ? <div className={className}>{content}</div> : <>{content}</>;
}
