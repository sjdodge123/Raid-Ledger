interface PluginBadgeProps {
    icon: string;
    color: string;
    label: string;
}

const COLOR_CLASSES: Record<string, string> = {
    blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    amber: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    emerald: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    red: 'bg-red-500/20 text-red-400 border-red-500/30',
    purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    cyan: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    orange: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    pink: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
};

const FALLBACK_COLOR = 'bg-gray-500/20 text-gray-400 border-gray-500/30';

/**
 * Small pill badge identifying a plugin's UI contribution (ROK-302).
 * Renders the plugin icon with a colored background; native title tooltip shows the label.
 */
export function PluginBadge({ icon, color, label }: PluginBadgeProps) {
    const colorClasses = COLOR_CLASSES[color] ?? FALLBACK_COLOR;

    return (
        <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${colorClasses}`}
            title={label}
            aria-label={label}
        >
            <span aria-hidden="true">{icon}</span>
        </span>
    );
}
