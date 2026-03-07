import type { ReactNode } from 'react';
import type { PluginBadgeMeta } from '../../plugins/plugin-registry';
import { PluginBadge } from '../ui/plugin-badge';

interface IntegrationCardProps {
    title: string;
    description: string;
    icon: ReactNode;
    isConfigured: boolean;
    isLoading?: boolean;
    badge?: ReactNode;
    pluginBadge?: PluginBadgeMeta;
    onMouseEnter?: () => void;
    children: ReactNode;
}

function statusBadgeClass(isLoading: boolean, isConfigured: boolean) {
    if (isLoading) return 'bg-overlay text-muted';
    if (isConfigured) return 'bg-emerald-500/20 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.4)]';
    return 'bg-red-500/20 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.4)] animate-pulse';
}

function statusBadgeLabel(isLoading: boolean, isConfigured: boolean) {
    if (isLoading) return 'Loading...';
    return isConfigured ? 'Online' : 'Offline';
}

function CardIcon({ icon, pluginBadge }: { icon: ReactNode; pluginBadge?: PluginBadgeMeta }) {
    if (pluginBadge) return <PluginBadge icon={pluginBadge.icon} iconSmall={pluginBadge.iconSmall} label={pluginBadge.label} size="md" />;
    return <div className="w-10 h-10 rounded-lg flex items-center justify-center">{icon}</div>;
}

/**
 * Always-expanded card for integration configurations.
 * Shows status badge in the header and content below.
 */
export function IntegrationCard({
    title, description, icon, isConfigured, isLoading = false,
    badge, pluginBadge, onMouseEnter, children,
}: IntegrationCardProps) {
    return (
        <div className="bg-panel/50 backdrop-blur-sm rounded-xl border border-edge/50 overflow-hidden" onMouseEnter={onMouseEnter}>
            <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <CardIcon icon={icon} pluginBadge={pluginBadge} />
                    <div className="text-left">
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                            {badge}
                        </div>
                        <p className="text-sm text-muted">{description}</p>
                    </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${statusBadgeClass(isLoading, isConfigured)}`}>
                    {statusBadgeLabel(isLoading, isConfigured)}
                </div>
            </div>
            <div className="p-6 pt-2 border-t border-edge/50">{children}</div>
        </div>
    );
}
