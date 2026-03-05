import { useState, useMemo } from 'react';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { PlayerCard } from '../events/player-card';
import { ROLE_SLOT_COLORS, formatRole } from '../../lib/role-colors';
import { RoleIcon } from '../shared/RoleIcon';
import { useUserCharacters } from '../../hooks/use-characters';
import { ModalPlayerRow } from './ModalPlayerRow';
import { CharacterSelectionView } from './CharacterSelectionView';
import { SlotPickerView, ReassignSlotPickerView } from './SlotPickerView';
import type { AssignmentPopupProps, SlotGroup } from './assignment-popup.types';
import { PUG_ELIGIBLE_ROLES } from './assignment-popup.types';
import './AssignmentPopup.css';

export type { AvailableSlot, AssignmentSelection } from './assignment-popup.types';

/**
 * AssignmentPopup - Modal for assigning unassigned players to roster slots (ROK-208).
 * ROK-461: After admin selects a player, shows character/role selection step before confirming.
 */
export function AssignmentPopup({
    isOpen, onClose, slotRole, slotPosition, unassigned, currentOccupant,
    onAssign, onRemove, onSelfAssign, availableSlots, onAssignToSlot,
    onGenerateInviteLink, onRemoveFromEvent, onReassignToSlot,
    assigned = [], gameId, isMMO, currentUserId, onSelfSlotClick,
}: AssignmentPopupProps) {
    const [search, setSearch] = useState('');
    const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
    const [reassignMode, setReassignMode] = useState(false);
    const [selectionTarget, setSelectionTarget] = useState<RosterAssignmentResponse | null>(null);
    const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
    const [selectedRole, setSelectedRole] = useState<RosterRole | null>(null);

    const isBrowseAll = slotRole === null;
    const selectedPlayer = selectedPlayerId != null ? unassigned.find(u => u.signupId === selectedPlayerId) : null;
    const { data: playerCharacters, isLoading: isLoadingCharacters } = useUserCharacters(selectionTarget?.userId ?? null, gameId);

    const { matching, other } = useMemo(() => {
        const lowerSearch = search.toLowerCase();
        const filtered = search
            ? unassigned.filter(u => u.username.toLowerCase().includes(lowerSearch) || u.character?.name?.toLowerCase().includes(lowerSearch))
            : unassigned;
        if (!slotRole) return { matching: [], other: filtered };
        const match = filtered.filter(u =>
            u.character?.role === slotRole || (u.preferredRoles && u.preferredRoles.includes(slotRole as 'tank' | 'healer' | 'dps'))
        );
        const matchIds = new Set(match.map(u => u.signupId));
        return { matching: match, other: filtered.filter(u => !matchIds.has(u.signupId)) };
    }, [unassigned, slotRole, search]);

    const slotsByRole: SlotGroup[] = useMemo(() => {
        if (!availableSlots) return [];
        const groups = new Map<string, typeof availableSlots>();
        for (const slot of availableSlots) {
            const existing = groups.get(slot.role) ?? [];
            existing.push(slot);
            groups.set(slot.role, existing);
        }
        return Array.from(groups.entries()).map(([role, slots]) => ({ role, label: slots[0].label, slots }));
    }, [availableSlots]);

    const title = selectionTarget
        ? `Select Character for ${selectionTarget.username}`
        : reassignMode && currentOccupant ? `Reassign ${currentOccupant.username}`
        : selectedPlayer ? `Pick a slot for ${selectedPlayer.username}`
        : slotRole && slotPosition > 0 ? `Assign to ${formatRole(slotRole)} ${slotPosition}`
        : 'Unassigned Players';

    const enterSelectionStep = (player: RosterAssignmentResponse) => {
        if (currentUserId && player.userId === currentUserId && onSelfSlotClick && slotRole && slotPosition > 0) {
            onClose(); onSelfSlotClick(slotRole, slotPosition); return;
        }
        if (!gameId || !isMMO) {
            if (isBrowseAll && onAssignToSlot && availableSlots) { setSelectedPlayerId(player.signupId); }
            else { onAssign(player.signupId); setSearch(''); }
            return;
        }
        setSelectionTarget(player);
        setSelectedCharacterId(player.character?.id ?? null);
        setSelectedRole(slotRole);
    };

    const handleAssign = (signupId: number) => {
        const player = unassigned.find(u => u.signupId === signupId);
        if (!player) return;
        if (isBrowseAll && onAssignToSlot && availableSlots) {
            if (gameId && isMMO) { enterSelectionStep(player); } else { setSelectedPlayerId(signupId); }
        } else { enterSelectionStep(player); }
    };

    const handleSelectionConfirm = () => {
        if (!selectionTarget) return;
        if (isBrowseAll && onAssignToSlot && availableSlots) {
            setSelectedPlayerId(selectionTarget.signupId); setSelectionTarget(null);
        } else {
            onAssign(selectionTarget.signupId, { characterId: selectedCharacterId ?? undefined, role: selectedRole ?? undefined });
            setSelectionTarget(null); setSelectedCharacterId(null); setSelectedRole(null); setSearch('');
        }
    };

    const handleSelectionSkip = () => {
        if (!selectionTarget) return;
        if (isBrowseAll && onAssignToSlot && availableSlots) {
            setSelectedPlayerId(selectionTarget.signupId); setSelectionTarget(null);
        } else {
            onAssign(selectionTarget.signupId);
            setSelectionTarget(null); setSelectedCharacterId(null); setSelectedRole(null); setSearch('');
        }
    };

    const handleSlotPick = (role: RosterRole, position: number) => {
        if (selectedPlayerId != null && onAssignToSlot) {
            onAssignToSlot(selectedPlayerId, role, position, { characterId: selectedCharacterId ?? undefined });
            setSelectedPlayerId(null); setSelectedCharacterId(null); setSelectedRole(null); setSearch('');
        }
    };

    const handleBack = () => {
        if (selectionTarget) { setSelectionTarget(null); setSelectedCharacterId(null); setSelectedRole(null); }
        else if (reassignMode) { setReassignMode(false); }
        else { setSelectedPlayerId(null); }
    };

    const handleClose = () => {
        setSelectedPlayerId(null); setReassignMode(false); setSelectionTarget(null);
        setSelectedCharacterId(null); setSelectedRole(null); setSearch(''); onClose();
    };

    const handleReassignSlotPick = (role: RosterRole, position: number) => {
        if (currentOccupant && onReassignToSlot) { onReassignToSlot(currentOccupant.signupId, role, position); setReassignMode(false); }
    };

    const canInvitePug = !isBrowseAll && slotRole !== null && PUG_ELIGIBLE_ROLES.has(slotRole) && !!onGenerateInviteLink;

    // Character selection step view
    if (selectionTarget) {
        return (
            <CharacterSelectionView
                isOpen={isOpen} title={title} selectionTarget={selectionTarget}
                characters={playerCharacters ?? []} isLoadingCharacters={isLoadingCharacters}
                selectedCharacterId={selectedCharacterId} slotRole={slotRole}
                onSelectCharacter={(charId, role) => { setSelectedCharacterId(charId); if (role) setSelectedRole(role); }}
                onConfirm={handleSelectionConfirm} onSkip={handleSelectionSkip}
                onBack={handleBack} onClose={handleClose}
            />
        );
    }

    // Reassign slot picker view
    if (reassignMode && currentOccupant && availableSlots) {
        return (
            <ReassignSlotPickerView
                isOpen={isOpen} title={title} currentOccupant={currentOccupant}
                slotsByRole={slotsByRole} slotRole={slotRole} slotPosition={slotPosition}
                onSlotPick={handleReassignSlotPick} onBack={handleBack} onClose={handleClose}
            />
        );
    }

    // Slot picker view
    if (selectedPlayer && availableSlots) {
        return (
            <SlotPickerView
                isOpen={isOpen} title={title} player={selectedPlayer}
                slotsByRole={slotsByRole} onSlotPick={handleSlotPick}
                onBack={handleBack} onClose={handleClose}
            />
        );
    }

    // Player list view (default)
    return (
        <Modal isOpen={isOpen} onClose={handleClose} title={title} maxWidth="max-w-md">
            <div className="assignment-popup">
                <SearchBar search={search} onSearch={setSearch} />
                <SelfAssignSection onSelfAssign={onSelfAssign} slotRole={slotRole} slotPosition={slotPosition} />
                <OccupantSection
                    currentOccupant={currentOccupant} onRemove={onRemove}
                    onReassignToSlot={onReassignToSlot ? () => setReassignMode(true) : undefined}
                    onRemoveFromEvent={onRemoveFromEvent} onClose={handleClose}
                />
                <MatchingSection slotRole={slotRole} matching={matching} onAssign={handleAssign} onRemoveFromEvent={onRemoveFromEvent} onClose={handleClose} />
                <OtherSection slotRole={slotRole} matching={matching} other={other} onAssign={handleAssign} onRemoveFromEvent={onRemoveFromEvent} onClose={handleClose} />
                {matching.length === 0 && other.length === 0 && !assigned.some(a => !(a.slot === slotRole && a.position === slotPosition)) && (
                    <div className="assignment-popup__empty">
                        {search ? 'No players match your search.' : 'All players are assigned to slots \u2713'}
                    </div>
                )}
                <RosterPlayersSection
                    isBrowseAll={isBrowseAll} slotRole={slotRole} slotPosition={slotPosition}
                    assigned={assigned} search={search} onReassignToSlot={onReassignToSlot}
                    onClose={handleClose}
                />
                <InvitePugSection canInvitePug={canInvitePug} onGenerateInviteLink={onGenerateInviteLink} onClose={handleClose} />
            </div>
        </Modal>
    );
}

function SearchBar({ search, onSearch }: { search: string; onSearch: (v: string) => void }) {
    return (
        <div className="assignment-popup__search-wrapper">
            <input type="text" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search by name..." className="assignment-popup__search" autoFocus />
        </div>
    );
}

function SelfAssignSection({ onSelfAssign, slotRole, slotPosition }: { onSelfAssign?: () => void; slotRole: RosterRole | null; slotPosition: number }) {
    if (!onSelfAssign || !slotRole || slotPosition <= 0) return null;
    return (
        <div className="assignment-popup__section">
            <button onClick={onSelfAssign} className="assignment-popup__self-assign-btn">
                Assign Myself to {formatRole(slotRole)} {slotPosition}
            </button>
        </div>
    );
}

function OccupantSection({
    currentOccupant, onRemove, onReassignToSlot, onRemoveFromEvent, onClose,
}: {
    currentOccupant?: RosterAssignmentResponse; onRemove?: (id: number) => void;
    onReassignToSlot?: () => void; onRemoveFromEvent?: (id: number, name: string) => void;
    onClose: () => void;
}) {
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

function MatchingSection({
    slotRole, matching, onAssign, onRemoveFromEvent, onClose,
}: {
    slotRole: RosterRole | null; matching: RosterAssignmentResponse[];
    onAssign: (id: number) => void; onRemoveFromEvent?: (id: number, name: string) => void;
    onClose: () => void;
}) {
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

function OtherSection({
    slotRole, matching, other, onAssign, onRemoveFromEvent, onClose,
}: {
    slotRole: RosterRole | null; matching: RosterAssignmentResponse[]; other: RosterAssignmentResponse[];
    onAssign: (id: number) => void; onRemoveFromEvent?: (id: number, name: string) => void;
    onClose: () => void;
}) {
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

function RosterPlayersSection({
    isBrowseAll, slotRole, slotPosition, assigned, search, onReassignToSlot, onClose,
}: {
    isBrowseAll: boolean; slotRole: RosterRole | null; slotPosition: number;
    assigned: RosterAssignmentResponse[]; search: string;
    onReassignToSlot?: (id: number, role: RosterRole, pos: number) => void;
    onClose: () => void;
}) {
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

function InvitePugSection({ canInvitePug, onGenerateInviteLink, onClose }: { canInvitePug: boolean; onGenerateInviteLink?: () => void; onClose: () => void }) {
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
