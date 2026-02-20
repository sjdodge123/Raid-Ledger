import { isImageIcon } from '../../plugins/plugin-registry';

interface PluginBadgeProps {
    icon: string;
    /** Optional smaller icon URL for compact variant */
    iconSmall?: string;
    color: string;
    label: string;
    /** Render a larger, more prominent badge (for admin/management UIs) */
    size?: 'sm' | 'md';
}

const COLOR_CLASSES: Record<string, string> = {
    blue: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    amber: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    emerald: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    red: 'bg-red-500/20 text-red-300 border-red-500/40',
    purple: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    cyan: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    orange: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    pink: 'bg-pink-500/20 text-pink-300 border-pink-500/40',
};

const FALLBACK_COLOR = 'bg-gray-500/20 text-gray-300 border-gray-500/40';

/**
 * Pill badge identifying a plugin's UI contribution (ROK-302).
 * Supports emoji icons and image URLs. Size "sm" for inline/slot badges,
 * "md" for prominent admin/management contexts.
 */
export function PluginBadge({ icon, iconSmall, color, label, size = 'sm' }: PluginBadgeProps) {
    const colorClasses = COLOR_CLASSES[color] ?? FALLBACK_COLOR;
    const imageUrl = isImageIcon(icon);

    if (size === 'md') {
        return (
            <span
                className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${colorClasses}`}
                title={label}
                aria-label={label}
            >
                {imageUrl ? (
                    <img
                        src={icon}
                        alt=""
                        className="w-6 h-6 rounded object-cover"
                        aria-hidden="true"
                    />
                ) : (
                    <span className="text-base" aria-hidden="true">{icon}</span>
                )}
                <span>{label}</span>
            </span>
        );
    }

    // sm (default) — compact badge for PluginSlot overlays
    const displayIcon = iconSmall ?? icon;
    const displayIsImage = isImageIcon(displayIcon);

    return (
        <span
            className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-xs font-medium border ${colorClasses}`}
            title={label}
            aria-label={label}
        >
            {displayIsImage ? (
                <img
                    src={displayIcon}
                    alt=""
                    className="w-4 h-4 rounded-sm object-cover"
                    aria-hidden="true"
                />
            ) : (
                <span aria-hidden="true">{displayIcon}</span>
            )}
        </span>
    );
}
