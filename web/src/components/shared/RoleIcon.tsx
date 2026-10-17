import { getRoleIconUrl } from '../../plugins/wow/lib/role-icons';

interface RoleIconProps {
    role: string;
    /** Tailwind size class (default: 'w-4 h-4') */
    size?: string;
    className?: string;
}

/**
 * Renders a WoW Dungeon Finder role icon for tank/healer/dps.
 * Falls back to a colored dot for other roles.
 */
export function RoleIcon({ role, size = 'w-4 h-4', className = '' }: RoleIconProps) {
    const url = getRoleIconUrl(role);
    if (url) {
        return <img src={url} alt={role} className={`${size} inline-block ${className}`} />;
    }
    return null;
}
