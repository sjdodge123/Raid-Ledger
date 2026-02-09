import type { ReactNode } from 'react';

/** Platform identifiers for integration spokes */
export type IntegrationPlatform = 'discord' | 'battlenet' | 'steam';

/** Status of a user's link to a platform */
export type SpokeStatus = 'active' | 'dormant' | 'placeholder';

interface IntegrationSpokeProps {
    platform: IntegrationPlatform;
    status: SpokeStatus;
    label: string;
    statusText: string;
    tooltipText?: string;
    /** Position angle on the orbital ring (0-360 degrees) */
    angle: number;
    onLink?: () => void;
    onViewDetails?: () => void;
    /** Called when hover state changes (AC-5: sympathetic ghost glow) */
    onHoverChange?: (hovered: boolean) => void;
}

/** Platform icon SVGs */
const PLATFORM_ICONS: Record<IntegrationPlatform, ReactNode> = {
    discord: (
        <svg className="spoke-node__icon" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
    ),
    battlenet: (
        <svg className="spoke-node__icon" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10.457 0c-.17.002-.34.018-.508.048C6.073.91 4.534 5.092 4.534 5.092s-.372-.273-.874-.467c0 0-1.235 3.08.02 6.141-1.467.527-3.126 1.545-3.496 3.093-.757 3.168 3.359 4.983 3.359 4.983s-.06.274-.026.674c0 0 3.104.787 6.065-.926.37 1.516 1.335 3.23 2.862 3.73 3.122 1.022 5.786-2.697 5.786-2.697s.268.087.633.106c0 0 1.095-2.963-.456-5.914 1.425-.607 2.988-1.726 3.178-3.303.387-3.228-4.063-4.423-4.063-4.423s.029-.277-.029-.67c0 0-2.39-.487-4.906.69 0 0-.148-.079-.362-.163C12.09.913 11.182-.008 10.457 0zM8.04 6.434c.348-.014.76.078 1.244.315 0 0 .917-2.788 3.695-4.078 0 0-1.147 1.994-.856 3.558.147.08.302.16.456.253 0 0 .236-.787.877-1.626.641-.84 1.753-1.637 3.38-1.334 0 0-2.15 1.106-2.456 2.549a9.53 9.53 0 0 1 .888.87l.022.026c.14-.337.557-1.12 1.407-1.7 0 0-.197 1.773-.837 2.818.195.345.363.71.503 1.093 0 0 1.703-1.666 4.218-1.66 0 0-2.31.955-2.963 2.31a5.09 5.09 0 0 1-.132 1.129c.356.05 1.17.104 2.21-.21 0 0-1.3 1.392-2.837 1.281a6.51 6.51 0 0 1-.57 1.067c.265.246 1.04.858 2.22 1.048 0 0-1.858.462-3.115-.39a7.55 7.55 0 0 1-1.049.702s.71 2.636-.328 4.998c0 0-.327-2.273-1.478-3.235a4.79 4.79 0 0 1-.92.196c.047.37.257 1.186.949 2.03 0 0-1.478-1.018-1.717-2.497a5.3 5.3 0 0 1-1.076-.244c-.118.328-.415 1.143-.253 2.267 0 0-.908-1.6-.286-3.069A8.03 8.03 0 0 1 8.18 16.5s-2.467.99-4.804.355c0 0 2.19-.65 3.186-1.648a4.87 4.87 0 0 1-.47-.895c-.343.151-1.14.44-2.138.304 0 0 1.68-.63 2.438-1.505a6.32 6.32 0 0 1-.315-1.213c-.359-.031-1.17-.02-2.103.467 0 0 1.24-1.262 2.535-1.32a7.08 7.08 0 0 1 .1-1.261c-.329-.109-1.2-.337-2.331-.1 0 0 1.69-.858 3.057-.37.21-.506.464-.969.754-1.38 0 0-2.76-.298-4.795 1.12 0 0 1.538-1.979 3.622-2.348a.85.85 0 0 1 .124-.272z" />
        </svg>
    ),
    steam: (
        <svg className="spoke-node__icon" fill="currentColor" viewBox="0 0 24 24">
            <path d="M11.979 0C5.678 0 .511 4.86.022 10.94l6.432 2.658a3.387 3.387 0 0 1 1.912-.59c.064 0 .127.003.19.007l2.862-4.145V8.82c0-2.578 2.098-4.675 4.676-4.675s4.676 2.097 4.676 4.675-2.098 4.676-4.676 4.676h-.109l-4.078 2.91c0 .049.003.097.003.146 0 1.934-1.573 3.507-3.507 3.507-1.704 0-3.126-1.222-3.438-2.838L.254 15.29C1.512 20.223 6.31 24 11.979 24c6.627 0 12.001-5.373 12.001-12S18.606 0 11.979 0zM7.54 18.21l-1.473-.61a2.627 2.627 0 0 0 4.867-1.375 2.627 2.627 0 0 0-2.625-2.625c-.09 0-.178.005-.265.013l1.523.63c1.088.45 1.605 1.69 1.155 2.778-.45 1.087-1.69 1.605-2.778 1.155l-.404-.167zm11.59-9.39a3.12 3.12 0 0 0-3.117-3.118 3.12 3.12 0 0 0-3.118 3.118 3.12 3.12 0 0 0 3.118 3.117 3.12 3.12 0 0 0 3.118-3.117zm-5.455 0a2.34 2.34 0 0 1 2.338-2.338 2.34 2.34 0 0 1 2.337 2.338 2.34 2.34 0 0 1-2.337 2.338 2.34 2.34 0 0 1-2.338-2.338z" />
        </svg>
    ),
};

/**
 * Individual platform spoke node for the Integration Hub (ROK-195).
 * Hexagonal frame with platform icon, positioned on orbital ring.
 * Shows tractor beam when active.
 */
export function IntegrationSpoke({
    platform,
    status,
    label,
    statusText,
    tooltipText,
    angle,
    onLink,
    onViewDetails,
    onHoverChange,
}: IntegrationSpokeProps) {
    const handleClick = () => {
        if (status === 'active' && onViewDetails) {
            onViewDetails();
        } else if (status === 'dormant' && onLink) {
            onLink();
        }
        // placeholder spokes are not clickable
    };

    return (
        <div
            className={`spoke-node spoke-node--${status}`}
            style={{
                '--node-angle': `${angle}deg`,
            } as React.CSSProperties}
            onClick={handleClick}
            onMouseEnter={() => onHoverChange?.(true)}
            onMouseLeave={() => onHoverChange?.(false)}
            role="button"
            tabIndex={status === 'placeholder' ? -1 : 0}
            aria-label={`${label} — ${statusText}`}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleClick();
                }
            }}
        >
            {/* Tooltip */}
            <div className="spoke-tooltip">
                {tooltipText || `${label} ${statusText}`}
            </div>

            {/* Hexagonal Icon Frame */}
            <div className="spoke-node__hex-frame">
                {/* Counter-rotated icon container */}
                <div className="spoke-node__icon-container">
                    {PLATFORM_ICONS[platform]}
                </div>

                {/* Status overlays */}
                {status === 'dormant' && (
                    <div className="spoke-node__plus" aria-hidden="true">+</div>
                )}
                {status === 'placeholder' && (
                    <div className="spoke-node__lock" aria-hidden="true">🔒</div>
                )}
            </div>

            {/* Tractor Beam (only for active spokes) */}
            {status === 'active' && (
                <div className="tractor-beam">
                    <div className="tractor-beam__gradient" />
                    <div className="tractor-beam__particles" />
                </div>
            )}

            {/* Label with counter-rotation */}
            <span className="spoke-node__label">
                {label}
            </span>

            {/* Status with counter-rotation */}
            <span className="spoke-node__status">
                {statusText}
            </span>
        </div>
    );
}
