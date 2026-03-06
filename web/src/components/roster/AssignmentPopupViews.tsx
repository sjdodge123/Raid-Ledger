import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { CharacterSelectionView } from './CharacterSelectionView';
import { SlotPickerView, ReassignSlotPickerView } from './SlotPickerView';
import type { SlotGroup } from './assignment-popup.types';
import { SearchBar, SelfAssignSection, OccupantSection, MatchingSection, OtherSection, RosterPlayersSection, InvitePugSection } from './AssignmentPopupSections';

/** Character selection step view */
export function SelectionStepView({ isOpen, title, selectionTarget, playerCharacters, isLoadingCharacters, selectedCharacterId, slotRole, onSelectCharacter, onConfirm, onSkip, onBack, onClose }: {
    isOpen: boolean; title: string; selectionTarget: RosterAssignmentResponse;
    playerCharacters: Array<{ id: string; name: string; role?: string }>; isLoadingCharacters: boolean;
    selectedCharacterId: string | null; slotRole: RosterRole | null;
    onSelectCharacter: (charId: string, role?: RosterRole) => void;
    onConfirm: () => void; onSkip: () => void; onBack: () => void; onClose: () => void;
}): JSX.Element {
    return (
        <CharacterSelectionView
            isOpen={isOpen} title={title} selectionTarget={selectionTarget}
            characters={playerCharacters} isLoadingCharacters={isLoadingCharacters}
            selectedCharacterId={selectedCharacterId} slotRole={slotRole}
            onSelectCharacter={onSelectCharacter} onConfirm={onConfirm}
            onSkip={onSkip} onBack={onBack} onClose={onClose}
        />
    );
}

/** Reassign slot picker view */
export function ReassignStepView({ isOpen, title, currentOccupant, slotsByRole, slotRole, slotPosition, onSlotPick, onBack, onClose }: {
    isOpen: boolean; title: string; currentOccupant: RosterAssignmentResponse;
    slotsByRole: SlotGroup[]; slotRole: RosterRole | null; slotPosition: number;
    onSlotPick: (role: RosterRole, pos: number) => void; onBack: () => void; onClose: () => void;
}): JSX.Element {
    return (
        <ReassignSlotPickerView
            isOpen={isOpen} title={title} currentOccupant={currentOccupant}
            slotsByRole={slotsByRole} slotRole={slotRole} slotPosition={slotPosition}
            onSlotPick={onSlotPick} onBack={onBack} onClose={onClose}
        />
    );
}

/** Slot picker view for selected player */
export function SlotStepView({ isOpen, title, player, slotsByRole, onSlotPick, onBack, onClose }: {
    isOpen: boolean; title: string; player: RosterAssignmentResponse;
    slotsByRole: SlotGroup[]; onSlotPick: (role: RosterRole, pos: number) => void;
    onBack: () => void; onClose: () => void;
}): JSX.Element {
    return (
        <SlotPickerView
            isOpen={isOpen} title={title} player={player}
            slotsByRole={slotsByRole} onSlotPick={onSlotPick}
            onBack={onBack} onClose={onClose}
        />
    );
}

/** Default player-list view of the assignment popup */
export function PlayerListView({ isOpen, title, handleClose, search, setSearch, onSelfAssign, slotRole, slotPosition, currentOccupant, onRemove, onReassignToSlot, onRemoveFromEvent, matching, other, handleAssign, assigned, isBrowseAll, onReassignToSlotFn, canInvitePug, onGenerateInviteLink }: {
    isOpen: boolean; title: string; handleClose: () => void;
    search: string; setSearch: (v: string) => void;
    onSelfAssign?: () => void; slotRole: RosterRole | null; slotPosition: number;
    currentOccupant?: RosterAssignmentResponse; onRemove?: (id: number) => void;
    onReassignToSlot?: () => void; onRemoveFromEvent?: (id: number, name: string) => void;
    matching: RosterAssignmentResponse[]; other: RosterAssignmentResponse[];
    handleAssign: (id: number) => void; assigned: RosterAssignmentResponse[];
    isBrowseAll: boolean; canInvitePug: boolean;
    onReassignToSlotFn?: (id: number, role: RosterRole, pos: number) => void;
    onGenerateInviteLink?: () => void;
}): JSX.Element {
    return (
        <Modal isOpen={isOpen} onClose={handleClose} title={title} maxWidth="max-w-md">
            <div className="assignment-popup">
                <SearchBar search={search} onSearch={setSearch} />
                <SelfAssignSection onSelfAssign={onSelfAssign} slotRole={slotRole} slotPosition={slotPosition} />
                <OccupantSection currentOccupant={currentOccupant} onRemove={onRemove} onReassignToSlot={onReassignToSlot} onRemoveFromEvent={onRemoveFromEvent} onClose={handleClose} />
                <MatchingSection slotRole={slotRole} matching={matching} onAssign={handleAssign} onRemoveFromEvent={onRemoveFromEvent} onClose={handleClose} />
                <OtherSection slotRole={slotRole} matching={matching} other={other} onAssign={handleAssign} onRemoveFromEvent={onRemoveFromEvent} onClose={handleClose} />
                <EmptyMessage matching={matching} other={other} assigned={assigned} slotRole={slotRole} slotPosition={slotPosition} search={search} />
                <RosterPlayersSection isBrowseAll={isBrowseAll} slotRole={slotRole} slotPosition={slotPosition} assigned={assigned} search={search} onReassignToSlot={onReassignToSlotFn} onClose={handleClose} />
                <InvitePugSection canInvitePug={canInvitePug} onGenerateInviteLink={onGenerateInviteLink} onClose={handleClose} />
            </div>
        </Modal>
    );
}

function EmptyMessage({ matching, other, assigned, slotRole, slotPosition, search }: {
    matching: RosterAssignmentResponse[]; other: RosterAssignmentResponse[];
    assigned: RosterAssignmentResponse[]; slotRole: RosterRole | null;
    slotPosition: number; search: string;
}): JSX.Element | null {
    if (matching.length > 0 || other.length > 0 || assigned.some(a => !(a.slot === slotRole && a.position === slotPosition))) return null;
    return <div className="assignment-popup__empty">{search ? 'No players match your search.' : 'All players are assigned to slots \u2713'}</div>;
}
