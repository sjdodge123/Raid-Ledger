import type { RosterAssignmentResponse } from '@raid-ledger/contract';
import { PlayerCard } from '../events/player-card';

interface RosterCardProps {
    item: RosterAssignmentResponse;
    /** Optional: admin remove button handler */
    onRemove?: (() => void) | undefined;
    /** The slot owns a stretched action button over this card: raise its controls and titled badges (TDB:1949) */
    raiseControls?: boolean;
}

/**
 * RosterCard - Static display card for a user in the roster (ROK-208).
 * Delegates to the shared PlayerCard component (ROK-210 AC-1).
 */
export function RosterCard({ item, onRemove, raiseControls }: RosterCardProps) {
    return (
        <PlayerCard
            player={item}
            size="compact"
            showRole
            onRemove={onRemove}
            raiseControls={raiseControls}
        />
    );
}
