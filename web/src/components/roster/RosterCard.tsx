import type { RosterAssignmentResponse } from '@raid-ledger/contract';
import { PlayerCard } from '../events/player-card';

interface RosterCardProps {
    item: RosterAssignmentResponse;
    /** Optional: admin remove button handler */
    onRemove?: () => void;
}

/**
 * RosterCard - Static display card for a user in the roster (ROK-208).
 * Delegates to the shared PlayerCard component (ROK-210 AC-1).
 */
export function RosterCard({ item, onRemove }: RosterCardProps) {
    return (
        <PlayerCard
            player={item}
            size="compact"
            showRole
            onRemove={onRemove}
        />
    );
}
