import { useState, type ReactNode } from 'react';

interface IntegrationCardProps {
    title: string;
    description: string;
    icon: ReactNode;
    isConfigured: boolean;
    isLoading?: boolean;
    defaultExpanded?: boolean;
    children: ReactNode;
}

/**
 * Collapsible card for integration configurations.
 * Shows status badge and expands to reveal settings.
 */
export function IntegrationCard({
    title,
    description,
    icon,
    isConfigured,
    isLoading = false,
    defaultExpanded = false,
    children,
}: IntegrationCardProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    return (
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden">
            {/* Header - Always Visible, Clickable */}
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full p-4 flex items-center justify-between hover:bg-slate-700/30 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center">
                        {icon}
                    </div>
                    <div className="text-left">
                        <h2 className="text-lg font-semibold text-white">{title}</h2>
                        <p className="text-sm text-slate-400">{description}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Status Badge */}
                    <div
                        className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${isLoading
                            ? 'bg-slate-700 text-slate-400'
                            : isConfigured
                                ? 'bg-emerald-500/20 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.4)] animate-pulse'
                                : 'bg-red-500/20 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.4)] animate-pulse'
                            }`}
                    >
                        {isLoading ? 'Loading...' : isConfigured ? '✓ Configured' : 'Not Configured'}
                    </div>

                    {/* Expand/Collapse Arrow */}
                    <svg
                        className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''
                            }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>

            {/* Content - Collapsible */}
            <div
                className={`transition-all duration-200 ease-in-out overflow-hidden ${isExpanded ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'
                    }`}
            >
                <div className="p-6 pt-2 border-t border-slate-700/50">
                    {children}
                </div>
            </div>
        </div>
    );
}
