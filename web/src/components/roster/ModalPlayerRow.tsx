import type { RosterAssignmentResponse } from '@raid-ledger/contract';
import { PlayerCard } from '../events/player-card';

/**
 * Individual player row in the assignment modal.
 * Uses shared PlayerCard (AC-1) with an Assign button alongside.
 * Matching-role rows get an accent left-border (AC-7).
 */
function RemoveFromEventButton({ player, onRemoveFromEvent, onClose }: {
    player: RosterAssignmentResponse;
    onRemoveFromEvent: (signupId: number, username: string) => void;
    onClose?: () => void;
}) {
    return (
        <button onClick={() => { onRemoveFromEvent(player.signupId, player.username); onClose?.(); }}
            className="assignment-popup__remove-event-btn" title={`Remove ${player.username} from event`}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
            </svg>
        </button>
    );
}

export function ModalPlayerRow({
    player, onAssign, accentColor, onRemoveFromEvent, onClose,
}: {
    player: RosterAssignmentResponse;
    onAssign: (signupId: number) => void;
    accentColor?: string;
    onRemoveFromEvent?: (signupId: number, username: string) => void;
    onClose?: () => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
                <PlayerCard player={player} size="compact" showRole matchAccent={accentColor} />
            </div>
            <div className="flex gap-1 shrink-0">
                <button onClick={() => onAssign(player.signupId)} className="assignment-popup__assign-btn">Assign</button>
                {onRemoveFromEvent && <RemoveFromEventButton player={player} onRemoveFromEvent={onRemoveFromEvent} onClose={onClose} />}
            </div>
        </div>
    );
}
