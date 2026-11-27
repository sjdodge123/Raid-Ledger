import { getRoleIconUrl } from './role-icons';

interface RoleIconProps {
    role: string;
    /** Tailwind size class (default: 'w-4 h-4') */
    size?: string;
    className?: string;
}

/**
 * Renders the core signup role icon for tank/healer/dps (ROK-2359: core, not WoW).
 * Renders nothing for other roles.
 */
export function RoleIcon({ role, size = 'w-4 h-4', className = '' }: RoleIconProps) {
    const url = getRoleIconUrl(role);
    if (url) {
        return <img src={url} alt={role} className={`${size} inline-block ${className}`} />;
    }
    return null;
}
