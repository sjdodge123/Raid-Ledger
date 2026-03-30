/**
 * Operator-only display of unlinked Steam member count (ROK-993).
 * Shows an amber text indicator when there are members without Steam linked.
 */
import { isOperatorOrAdmin, useAuth } from '../../hooks/use-auth';

interface UnlinkedSteamCountProps {
    count: number;
}

export function UnlinkedSteamCount({ count }: UnlinkedSteamCountProps) {
    const { user } = useAuth();

    if (!isOperatorOrAdmin(user) || count === 0) {
        return null;
    }

    return (
        <span
            className="text-sm text-amber-600 dark:text-amber-400"
            title={`${count} member${count === 1 ? '' : 's'} without Steam linked`}
        >
            {count} without Steam
        </span>
    );
}
