import type { ReactNode } from 'react';
import type { PluginBadgeMeta } from '../../plugins/plugin-registry';
import { PluginBadge } from '../ui/plugin-badge';

interface AdminPluginCardProps {
    title: string;
    version?: string;
    description: string;
    status?: 'active' | 'inactive' | 'not_installed';
    badge?: ReactNode;
    /** Plugin badge metadata — renders an image badge in the top-right corner */
    pluginBadge?: PluginBadgeMeta;
    onMouseEnter?: () => void;
    actions?: ReactNode;
    children?: ReactNode;
}

const STATUS_STYLES = {
    active: 'bg-emerald-500/20 text-emerald-400',
    inactive: 'bg-amber-500/20 text-amber-400',
    not_installed: 'bg-gray-500/20 text-gray-400',
} as const;

const STATUS_LABELS = {
    active: 'Active',
    inactive: 'Inactive',
    not_installed: 'Not Installed',
} as const;

/**
 * Non-collapsible card for a plugin on the Manage Plugins page.
 * All information is visible at a glance: name, version, description, status, actions, children.
 */
export function AdminPluginSection({
    title,
    version,
    description,
    status,
    badge,
    pluginBadge,
    onMouseEnter,
    actions,
    children,
}: AdminPluginCardProps) {
    return (
        <div
            className="relative backdrop-blur-sm rounded-xl overflow-hidden border bg-panel/50 border-edge/50"
            onMouseEnter={onMouseEnter}
        >
            {/* Plugin badge — top-right corner */}
            {pluginBadge && (
                <div className="absolute top-3 right-3 z-10">
                    <PluginBadge
                        icon={pluginBadge.icon}
                        iconSmall={pluginBadge.iconSmall}
                        label={pluginBadge.label}
                        size="md"
                    />
                </div>
            )}

            {/* Header */}
            <div className="px-5 pt-5 pb-3">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <h3 className="text-lg font-semibold text-foreground truncate">{title}</h3>
                            {version && (
                                <span className="text-xs text-dim bg-overlay px-2 py-0.5 rounded-full whitespace-nowrap">
                                    v{version}
                                </span>
                            )}
                            {status && (
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}>
                                    {STATUS_LABELS[status]}
                                </span>
                            )}
                            {badge}
                        </div>
                        <p className="text-sm text-muted mt-1">{description}</p>
                    </div>

                    {/* Action buttons — offset right to avoid badge overlap */}
                    {actions && (
                        <div className={`flex gap-2 flex-shrink-0 ${pluginBadge ? 'mt-10' : ''}`}>
                            {actions}
                        </div>
                    )}
                </div>
            </div>

            {/* Body content — always visible */}
            {children && (
                <div className="px-5 pb-5 pt-1 space-y-4 border-t mt-2 border-edge/50">
                    {children}
                </div>
            )}
        </div>
    );
}
