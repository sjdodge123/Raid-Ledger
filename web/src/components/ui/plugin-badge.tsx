import { isImageIcon } from '../../plugins/plugin-registry';

interface PluginBadgeProps {
    icon: string;
    /** Optional smaller icon URL for compact variant */
    iconSmall?: string;
    label: string;
    /** 'sm' for plugin slot badges (24x24), 'md' for admin UI (32x32) */
    size?: 'sm' | 'md';
}

/**
 * Image-only badge identifying a plugin's UI contribution (ROK-302).
 * Renders just the image with no background, border, or text.
 */
export function PluginBadge({ icon, iconSmall, label, size = 'sm' }: PluginBadgeProps) {
    const dimension = size === 'md' ? 'w-8 h-8' : 'w-6 h-6';

    const displayIcon = size === 'sm' ? (iconSmall ?? icon) : icon;
    const displayIsImage = isImageIcon(displayIcon);

    return displayIsImage ? (
        <span
            className={`${dimension} rounded-full overflow-hidden inline-flex items-center justify-center shrink-0`}
            aria-hidden="true"
            title={label}
        >
            <img
                src={displayIcon}
                alt=""
                className="w-full h-full object-cover scale-[1.45]"
            />
        </span>
    ) : (
        <span className={size === 'md' ? 'text-xl' : 'text-base'} aria-hidden="true" title={label}>
            {displayIcon}
        </span>
    );
}
