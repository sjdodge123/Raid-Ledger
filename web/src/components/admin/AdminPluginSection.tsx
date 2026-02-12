import { useState, type ReactNode } from 'react';

interface AdminPluginSectionProps {
    title: string;
    version?: string;
    status?: 'active' | 'inactive' | 'not_installed';
    isCore?: boolean;
    badge?: ReactNode;
    onMouseEnter?: () => void;
    actions?: ReactNode;
    defaultExpanded?: boolean;
    children: ReactNode;
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
 * Expandable section container for a plugin on the admin settings page.
 * All sections are collapsible; Core just gets a subtle label instead of version/status.
 */
export function AdminPluginSection({
    title,
    version,
    status,
    isCore = false,
    badge,
    onMouseEnter,
    actions,
    defaultExpanded = false,
    children,
}: AdminPluginSectionProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    return (
        <div
            className="bg-panel/50 backdrop-blur-sm rounded-xl border border-edge/50 overflow-hidden"
            onMouseEnter={onMouseEnter}
        >
            {/* Header */}
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className={`w-full ${isExpanded ? 'px-5 py-4' : 'px-4 py-3'} flex items-center justify-between hover:bg-overlay/30 cursor-pointer transition-all`}
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <h2 className={`${isExpanded ? 'text-lg' : 'text-base'} font-semibold text-foreground truncate transition-all`}>
                        {title}
                    </h2>
                    {isCore && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-dim bg-overlay px-2 py-0.5 rounded-full">
                            Core
                        </span>
                    )}
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

                <div className="flex items-center gap-2">
                    <svg
                        className={`w-5 h-5 text-muted transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>

            {/* Action buttons (outside the collapse toggle) */}
            {actions && (
                <div className="px-5 pb-3 -mt-1 flex gap-2">
                    {actions}
                </div>
            )}

            {/* Collapsible body */}
            <div
                className={`transition-all duration-200 ease-in-out overflow-hidden ${
                    isExpanded ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'
                }`}
            >
                <div className="px-5 pb-5 pt-1 space-y-6 border-t border-edge/50">
                    {children}
                </div>
            </div>
        </div>
    );
}
