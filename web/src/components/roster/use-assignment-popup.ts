import { useState, useMemo, useCallback } from 'react';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { formatRole } from '../../lib/role-colors';
import { useUserCharacters } from '../../hooks/use-characters';
import type { AssignmentPopupProps, SlotGroup } from './assignment-popup.types';
import { PUG_ELIGIBLE_ROLES } from './assignment-popup.types';

/** Core selection state (player, character, role, mode) */
function useSelectionState() {
    const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
    const [reassignMode, setReassignMode] = useState(false);
    const [selectionTarget, setSelectionTarget] = useState<RosterAssignmentResponse | null>(null);
    const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
    const [selectedRole, setSelectedRole] = useState<RosterRole | null>(null);
    const [search, setSearch] = useState('');

    const resetAll = useCallback((): void => {
        setSelectedPlayerId(null); setReassignMode(false); setSelectionTarget(null);
        setSelectedCharacterId(null); setSelectedRole(null); setSearch('');
    }, []);

    return {
        selectedPlayerId, setSelectedPlayerId, reassignMode, setReassignMode,
        selectionTarget, setSelectionTarget, selectedCharacterId, setSelectedCharacterId,
        selectedRole, setSelectedRole, search, setSearch, resetAll,
    };
}

/** Filtered player lists (matching role vs other) */
function useFilteredPlayers(unassigned: RosterAssignmentResponse[], slotRole: RosterRole | null, search: string) {
    return useMemo(() => {
        const lowerSearch = search.toLowerCase();
        const filtered = search
            ? unassigned.filter(u => u.username.toLowerCase().includes(lowerSearch) || u.character?.name?.toLowerCase().includes(lowerSearch))
            : unassigned;
        if (!slotRole) return { matching: [] as RosterAssignmentResponse[], other: filtered };
        const match = filtered.filter(u =>
            u.character?.role === slotRole || (u.preferredRoles && u.preferredRoles.includes(slotRole as 'tank' | 'healer' | 'dps'))
        );
        const matchIds = new Set(match.map(u => u.signupId));
        return { matching: match, other: filtered.filter(u => !matchIds.has(u.signupId)) };
    }, [unassigned, slotRole, search]);
}

/** Groups available slots by role */
function useSlotsByRole(availableSlots: AssignmentPopupProps['availableSlots']): SlotGroup[] {
    return useMemo(() => {
        if (!availableSlots) return [];
        const groups = new Map<string, typeof availableSlots>();
        for (const slot of availableSlots) {
            const existing = groups.get(slot.role) ?? [];
            existing.push(slot);
            groups.set(slot.role, existing);
        }
        return Array.from(groups.entries()).map(([role, slots]) => ({ role, label: slots[0].label, slots }));
    }, [availableSlots]);
}

/** Computes the modal title based on current state */
function computeTitle(
    selectionTarget: RosterAssignmentResponse | null, reassignMode: boolean,
    currentOccupant: RosterAssignmentResponse | undefined,
    selectedPlayer: RosterAssignmentResponse | undefined | null,
    slotRole: RosterRole | null, slotPosition: number,
): string {
    if (selectionTarget) return `Select Character for ${selectionTarget.username}`;
    if (reassignMode && currentOccupant) return `Reassign ${currentOccupant.username}`;
    if (selectedPlayer) return `Pick a slot for ${selectedPlayer.username}`;
    if (slotRole && slotPosition > 0) return `Assign to ${formatRole(slotRole)} ${slotPosition}`;
    return 'Unassigned Players';
}

/** Builds the enterSelectionStep handler */
function useEnterSelection(props: AssignmentPopupProps, state: ReturnType<typeof useSelectionState>) {
    const { slotRole, slotPosition, onClose, gameId, isMMO, onAssign, onAssignToSlot, availableSlots, currentUserId, onSelfSlotClick } = props;
    const isBrowseAll = slotRole === null;

    return useCallback((player: RosterAssignmentResponse): void => {
        if (currentUserId && player.userId === currentUserId && onSelfSlotClick && slotRole && slotPosition > 0) {
            onClose(); onSelfSlotClick(slotRole, slotPosition); return;
        }
        if (!gameId || !isMMO) {
            if (isBrowseAll && onAssignToSlot && availableSlots) { state.setSelectedPlayerId(player.signupId); }
            else { onAssign(player.signupId); state.setSearch(''); }
            return;
        }
        state.setSelectionTarget(player);
        state.setSelectedCharacterId(player.character?.id ?? null);
        state.setSelectedRole(slotRole);
    }, [currentUserId, onSelfSlotClick, slotRole, slotPosition, onClose, gameId, isMMO, isBrowseAll, onAssignToSlot, availableSlots, onAssign, state]);
}

/** Builds the assign-to-player handler */
function useHandleAssign(props: AssignmentPopupProps, state: ReturnType<typeof useSelectionState>, enterSelectionStep: (p: RosterAssignmentResponse) => void) {
    const { unassigned, onAssignToSlot, availableSlots, gameId, isMMO, slotRole } = props;
    const isBrowseAll = slotRole === null;
    return useCallback((signupId: number): void => {
        const player = unassigned.find(u => u.signupId === signupId);
        if (!player) return;
        if (isBrowseAll && onAssignToSlot && availableSlots) {
            if (gameId && isMMO) enterSelectionStep(player); else state.setSelectedPlayerId(signupId);
        } else enterSelectionStep(player);
    }, [unassigned, isBrowseAll, onAssignToSlot, availableSlots, gameId, isMMO, enterSelectionStep, state]);
}

/** Builds selection confirm/skip and slot-pick handlers */
function useSelectionHandlers(props: AssignmentPopupProps, state: ReturnType<typeof useSelectionState>) {
    const { onAssign, onAssignToSlot, availableSlots, slotRole } = props;
    const isBrowseAll = slotRole === null;
    const handleSelectionConfirm = useCallback((): void => {
        if (!state.selectionTarget) return;
        if (isBrowseAll && onAssignToSlot && availableSlots) {
            state.setSelectedPlayerId(state.selectionTarget.signupId); state.setSelectionTarget(null);
        } else {
            onAssign(state.selectionTarget.signupId, { characterId: state.selectedCharacterId ?? undefined, role: state.selectedRole ?? undefined });
            state.setSelectionTarget(null); state.setSelectedCharacterId(null); state.setSelectedRole(null); state.setSearch('');
        }
    }, [state, isBrowseAll, onAssignToSlot, availableSlots, onAssign]);
    const handleSelectionSkip = useCallback((): void => {
        if (!state.selectionTarget) return;
        if (isBrowseAll && onAssignToSlot && availableSlots) {
            state.setSelectedPlayerId(state.selectionTarget.signupId); state.setSelectionTarget(null);
        } else {
            onAssign(state.selectionTarget.signupId);
            state.setSelectionTarget(null); state.setSelectedCharacterId(null); state.setSelectedRole(null); state.setSearch('');
        }
    }, [state, isBrowseAll, onAssignToSlot, availableSlots, onAssign]);
    const handleSlotPick = useCallback((role: RosterRole, position: number): void => {
        if (state.selectedPlayerId != null && onAssignToSlot) { onAssignToSlot(state.selectedPlayerId, role, position, { characterId: state.selectedCharacterId ?? undefined }); state.resetAll(); }
    }, [state, onAssignToSlot]);
    return { handleSelectionConfirm, handleSelectionSkip, handleSlotPick };
}

function useReassignHandler(props: AssignmentPopupProps, state: ReturnType<typeof useSelectionState>) {
    const { currentOccupant, onReassignToSlot } = props;
    return useCallback((role: RosterRole, position: number): void => {
        if (currentOccupant && onReassignToSlot) { onReassignToSlot(currentOccupant.signupId, role, position); state.setReassignMode(false); }
    }, [currentOccupant, onReassignToSlot, state]);
}

/** Internal state and handlers for the AssignmentPopup */
export function useAssignmentPopup(props: AssignmentPopupProps) {
    const { slotRole, slotPosition, unassigned, currentOccupant, onGenerateInviteLink, onClose, gameId, availableSlots } = props;
    const state = useSelectionState();
    const isBrowseAll = slotRole === null;
    const selectedPlayer = state.selectedPlayerId != null ? unassigned.find(u => u.signupId === state.selectedPlayerId) : null;
    const { data: playerCharacters, isLoading: isLoadingCharacters } = useUserCharacters(state.selectionTarget?.userId ?? null, gameId);
    const canInvitePug = !isBrowseAll && slotRole !== null && PUG_ELIGIBLE_ROLES.has(slotRole) && !!onGenerateInviteLink;
    const { matching, other } = useFilteredPlayers(unassigned, slotRole, state.search);
    const slotsByRole = useSlotsByRole(availableSlots);
    const title = computeTitle(state.selectionTarget, state.reassignMode, currentOccupant, selectedPlayer, slotRole, slotPosition);
    const enterSelectionStep = useEnterSelection(props, state);
    const handleAssign = useHandleAssign(props, state, enterSelectionStep);
    const selectionHandlers = useSelectionHandlers(props, state);
    const handleReassignSlotPick = useReassignHandler(props, state);
    const handleClose = useCallback((): void => { state.resetAll(); onClose(); }, [state, onClose]);
    const handleBack = useCallback((): void => {
        if (state.selectionTarget) { state.setSelectionTarget(null); state.setSelectedCharacterId(null); state.setSelectedRole(null); }
        else if (state.reassignMode) state.setReassignMode(false);
        else state.setSelectedPlayerId(null);
    }, [state]);

    return {
        search: state.search, setSearch: state.setSearch, selectedPlayer, selectionTarget: state.selectionTarget,
        selectedCharacterId: state.selectedCharacterId, selectedRole: state.selectedRole, reassignMode: state.reassignMode,
        setReassignMode: state.setReassignMode, isBrowseAll, matching, other, slotsByRole, title, canInvitePug,
        playerCharacters: playerCharacters ?? [], isLoadingCharacters, setSelectedCharacterId: state.setSelectedCharacterId,
        setSelectedRole: state.setSelectedRole, handleClose, handleBack, handleAssign, handleReassignSlotPick, ...selectionHandlers,
    };
}
