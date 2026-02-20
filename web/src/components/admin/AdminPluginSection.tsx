import type { ReactNode } from 'react';
import type { PluginBadgeMeta } from '../../plugins/plugin-registry';
import { PluginBadge } from '../ui/plugin-badge';

interface AdminPluginCardProps {
    title: string;
    version?: string;
    description: string;
    status?: 'active' | 'inactive' | 'not_installed';
    badge?: ReactNode;
    /** Plugin badge metadata — renders a prominent badge with image/icon next to the title */
    pluginBadge?: PluginBadgeMeta;
    onMouseEnter?: () => void;
    actions?: ReactNode;
    children?: ReactNode;
    /** When true, applies the indigo plugin color scheme (left border + subtle tint) */
    isPlugin?: boolean;
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
    isPlugin = false,
}: AdminPluginCardProps) {
    return (
        <div
            className={`backdrop-blur-sm rounded-xl overflow-hidden border ${
                isPlugin
                    ? 'bg-indigo-500/5 border-edge/50 border-l-2 border-l-indigo-400/60'
                    : 'bg-panel/50 border-edge/50'
            }`}
            onMouseEnter={onMouseEnter}
        >
            {/* Header */}
            <div className="px-5 pt-5 pb-3">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                            {pluginBadge && (
                                <PluginBadge
                                    icon={pluginBadge.icon}
                                    iconSmall={pluginBadge.iconSmall}
                                    color={pluginBadge.color}
                                    label={pluginBadge.label}
                                    size="md"
                                />
                            )}
                            <h3 className="text-lg font-semibold text-foreground truncate">{title}</h3>
                            {version && (
                                <span className="text-xs text-dim bg-overlay px-2 py-0.5 rounded-full whitespace-nowrap">
                                    v{version}
                                </span>
                            )}
                            {isPlugin && !pluginBadge && (
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-indigo-500/20 text-indigo-400">
                                    Plugin
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

                    {/* Action buttons */}
                    {actions && (
                        <div className="flex gap-2 flex-shrink-0">
                            {actions}
                        </div>
                    )}
                </div>
            </div>

            {/* Body content — always visible */}
            {children && (
                <div className={`px-5 pb-5 pt-1 space-y-4 border-t mt-2 ${
                    isPlugin ? 'border-indigo-400/20' : 'border-edge/50'
                }`}>
                    {children}
                </div>
            )}
        </div>
    );
}
