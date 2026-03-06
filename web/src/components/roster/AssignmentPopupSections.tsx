import type { JSX } from 'react';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { PlayerCard } from '../events/player-card';
import { ROLE_SLOT_COLORS, formatRole } from '../../lib/role-colors';
import { RoleIcon } from '../shared/RoleIcon';
import { ModalPlayerRow } from './ModalPlayerRow';

/** Search input for filtering unassigned players */
export function SearchBar({ search, onSearch }: { search: string; onSearch: (v: string) => void }): JSX.Element {
    return (
        <div className="assignment-popup__search-wrapper">
            <input type="text" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search by name..." className="assignment-popup__search" autoFocus />
        </div>
    );
}

/** Self-assign button for the current user */
export function SelfAssignSection({ onSelfAssign, slotRole, slotPosition }: {
    onSelfAssign?: () => void; slotRole: RosterRole | null; slotPosition: number;
}): JSX.Element | null {
    if (!onSelfAssign || !slotRole || slotPosition <= 0) return null;
    return (
        <div className="assignment-popup__section">
            <button onClick={onSelfAssign} className="assignment-popup__self-assign-btn">
                Assign Myself to {formatRole(slotRole)} {slotPosition}
            </button>
        </div>
    );
}

/** Shows the current occupant with remove/reassign actions */
export function OccupantSection({ currentOccupant, onRemove, onReassignToSlot, onRemoveFromEvent, onClose }: {
    currentOccupant?: RosterAssignmentResponse; onRemove?: (id: number) => void;
    onReassignToSlot?: () => void; onRemoveFromEvent?: (id: number, name: string) => void;
    onClose: () => void;
}): JSX.Element | null {
    if (!currentOccupant || !onRemove) return null;
    return (
        <div className="assignment-popup__section">
            <h4 className="assignment-popup__section-title assignment-popup__section-title--remove">Current Occupant</h4>
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1"><PlayerCard player={currentOccupant} size="compact" showRole /></div>
                <div className="flex flex-col gap-1 shrink-0">
                    {onReassignToSlot && <button onClick={onReassignToSlot} className="assignment-popup__reassign-btn">Reassign</button>}
                    <button onClick={() => onRemove(currentOccupant.signupId)} className="assignment-popup__remove-btn">Unassign</button>
                    {onRemoveFromEvent && (
                        <button onClick={() => { onRemoveFromEvent(currentOccupant.signupId, currentOccupant.username); onClose(); }} className="assignment-popup__remove-event-btn">
                            Remove from event
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

/** Players matching the target slot role */
export function MatchingSection({ slotRole, matching, onAssign, onRemoveFromEvent, onClose }: {
    slotRole: RosterRole | null; matching: RosterAssignmentResponse[];
    onAssign: (id: number) => void; onRemoveFromEvent?: (id: number, name: string) => void;
    onClose: () => void;
}): JSX.Element | null {
    if (!slotRole || matching.length === 0) return null;
    return (
        <div className="assignment-popup__section">
            <h4 className="assignment-popup__section-title">
                <RoleIcon role={slotRole} size="w-4 h-4" /> Matching Role — {formatRole(slotRole)}
            </h4>
            {matching.map(player => (
                <ModalPlayerRow
                    key={player.signupId} player={player} onAssign={onAssign}
                    accentColor={(ROLE_SLOT_COLORS[slotRole] ?? ROLE_SLOT_COLORS.player).border}
                    onRemoveFromEvent={onRemoveFromEvent} onClose={onClose}
                />
            ))}
        </div>
    );
}

/** Other unassigned players not matching the role */
export function OtherSection({ slotRole, matching, other, onAssign, onRemoveFromEvent, onClose }: {
    slotRole: RosterRole | null; matching: RosterAssignmentResponse[]; other: RosterAssignmentResponse[];
    onAssign: (id: number) => void; onRemoveFromEvent?: (id: number, name: string) => void;
    onClose: () => void;
}): JSX.Element | null {
    if (other.length === 0) return null;
    return (
        <div className="assignment-popup__section">
            <h4 className="assignment-popup__section-title">
                {slotRole && matching.length > 0 ? 'Other Unassigned' : 'Unassigned Players'}
            </h4>
            {other.map(player => (
                <ModalPlayerRow key={player.signupId} player={player} onAssign={onAssign} onRemoveFromEvent={onRemoveFromEvent} onClose={onClose} />
            ))}
        </div>
    );
}

/** Already-assigned roster players that can be moved to the target slot */
export function RosterPlayersSection({ isBrowseAll, slotRole, slotPosition, assigned, search, onReassignToSlot, onClose }: {
    isBrowseAll: boolean; slotRole: RosterRole | null; slotPosition: number;
    assigned: RosterAssignmentResponse[]; search: string;
    onReassignToSlot?: (id: number, role: RosterRole, pos: number) => void;
    onClose: () => void;
}): JSX.Element | null {
    if (isBrowseAll || !slotRole || slotPosition <= 0 || !onReassignToSlot) return null;
    const lowerSearch = search.toLowerCase();
    const rosterPlayers = assigned.filter(a =>
        !(a.slot === slotRole && a.position === slotPosition) &&
        (!search || a.username.toLowerCase().includes(lowerSearch) || a.character?.name?.toLowerCase().includes(lowerSearch))
    );
    if (rosterPlayers.length === 0) return null;
    return (
        <div className="assignment-popup__section">
            <h4 className="assignment-popup__section-title">Roster Players</h4>
            {rosterPlayers.map(player => (
                <div key={player.signupId} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1"><PlayerCard player={player} size="compact" showRole /></div>
                    <button onClick={() => { onReassignToSlot(player.signupId, slotRole, slotPosition); onClose(); }} className="assignment-popup__assign-btn shrink-0">
                        Move here
                    </button>
                </div>
            ))}
        </div>
    );
}

/** Invite PUG button section */
export function InvitePugSection({ canInvitePug, onGenerateInviteLink, onClose }: {
    canInvitePug: boolean; onGenerateInviteLink?: () => void; onClose: () => void;
}): JSX.Element | null {
    if (!canInvitePug) return null;
    return (
        <div className="assignment-popup__section">
            <button
                type="button"
                onClick={() => { onGenerateInviteLink?.(); onClose(); }}
                className="btn btn-primary btn-sm w-full flex items-center justify-center gap-2"
            >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Invite a PUG
            </button>
            <p className="mt-1.5 text-xs text-dim">Generate a shareable invite link for this slot.</p>
        </div>
    );
}
