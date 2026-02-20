import { isImageIcon } from '../../plugins/plugin-registry';

interface PluginBadgeProps {
    icon: string;
    /** Optional smaller icon URL for compact variant */
    iconSmall?: string;
    color?: string;
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

    if (size === 'md') {
        const imageUrl = isImageIcon(icon);
        return imageUrl ? (
            <img
                src={icon}
                alt=""
                className={`${dimension} rounded object-cover`}
                aria-hidden="true"
                title={label}
            />
        ) : (
            <span className="text-xl" aria-hidden="true" title={label}>
                {icon}
            </span>
        );
    }

    // sm (default) — compact badge for PluginSlot overlays
    const displayIcon = iconSmall ?? icon;
    const displayIsImage = isImageIcon(displayIcon);

    return displayIsImage ? (
        <img
            src={displayIcon}
            alt=""
            className={`${dimension} rounded-sm object-cover`}
            aria-hidden="true"
            title={label}
        />
    ) : (
        <span className="text-base" aria-hidden="true" title={label}>
            {displayIcon}
        </span>
    );
}
