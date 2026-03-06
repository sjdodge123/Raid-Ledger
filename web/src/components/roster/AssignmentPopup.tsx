import type { JSX } from 'react';
import type { AssignmentPopupProps } from './assignment-popup.types';
import { SelectionStepView, ReassignStepView, SlotStepView, PlayerListView } from './AssignmentPopupViews';
import { useAssignmentPopup } from './use-assignment-popup';
import './AssignmentPopup.css';

export type { AvailableSlot, AssignmentSelection } from './assignment-popup.types';

/**
 * AssignmentPopup - Modal for assigning unassigned players to roster slots (ROK-208).
 * ROK-461: After admin selects a player, shows character/role selection step.
 */
export function AssignmentPopup(props: AssignmentPopupProps): JSX.Element {
    const s = useAssignmentPopup(props);
    const { isOpen, slotRole, slotPosition, currentOccupant, onRemove, onSelfAssign, availableSlots, onGenerateInviteLink, onRemoveFromEvent, onReassignToSlot, assigned = [] } = props;

    if (s.selectionTarget) {
        return <SelectionStepView isOpen={isOpen} title={s.title} selectionTarget={s.selectionTarget} playerCharacters={s.playerCharacters} isLoadingCharacters={s.isLoadingCharacters} selectedCharacterId={s.selectedCharacterId} slotRole={slotRole} onSelectCharacter={(charId, role) => { s.setSelectedCharacterId(charId); if (role) s.setSelectedRole(role); }} onConfirm={s.handleSelectionConfirm} onSkip={s.handleSelectionSkip} onBack={s.handleBack} onClose={s.handleClose} />;
    }
    if (s.reassignMode && currentOccupant && availableSlots) {
        return <ReassignStepView isOpen={isOpen} title={s.title} currentOccupant={currentOccupant} slotsByRole={s.slotsByRole} slotRole={slotRole} slotPosition={slotPosition} onSlotPick={s.handleReassignSlotPick} onBack={s.handleBack} onClose={s.handleClose} />;
    }
    if (s.selectedPlayer && availableSlots) {
        return <SlotStepView isOpen={isOpen} title={s.title} player={s.selectedPlayer} slotsByRole={s.slotsByRole} onSlotPick={s.handleSlotPick} onBack={s.handleBack} onClose={s.handleClose} />;
    }
    return <PlayerListView isOpen={isOpen} title={s.title} handleClose={s.handleClose} search={s.search} setSearch={s.setSearch} onSelfAssign={onSelfAssign} slotRole={slotRole} slotPosition={slotPosition} currentOccupant={currentOccupant} onRemove={onRemove} onReassignToSlot={onReassignToSlot ? () => s.setReassignMode(true) : undefined} onRemoveFromEvent={onRemoveFromEvent} matching={s.matching} other={s.other} handleAssign={s.handleAssign} assigned={assigned} isBrowseAll={s.isBrowseAll} onReassignToSlotFn={onReassignToSlot} canInvitePug={s.canInvitePug} onGenerateInviteLink={onGenerateInviteLink} />;
}
