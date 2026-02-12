import type { UserRole } from '@raid-ledger/contract';

interface RoleBadgeProps {
    role?: UserRole;
    className?: string;
}

/**
 * Badge displaying user role (ROK-272).
 * Admin: amber, Operator: emerald, Member: no badge shown.
 */
export function RoleBadge({ role, className = '' }: RoleBadgeProps) {
    if (!role || role === 'member') return null;

    if (role === 'admin') {
        return (
            <span
                className={`inline-block px-2 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30 ${className}`}
            >
                Admin
            </span>
        );
    }

    if (role === 'operator') {
        return (
            <span
                className={`inline-block px-2 py-0.5 text-xs font-medium bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30 ${className}`}
            >
                Operator
            </span>
        );
    }

    return null;
}
