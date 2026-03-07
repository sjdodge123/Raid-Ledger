import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { useSignup, useCancelSignup } from '../../hooks/use-signups';
import type { CharacterRole } from '@raid-ledger/contract';

const ROLE_LABELS: Record<string, string> = {
    tank: 'Tank', healer: 'Healer', dps: 'DPS', flex: 'Flex',
};

/**
 * Find the first unoccupied position (1-indexed) for a given role.
 */
export function findNextAvailablePosition(
    role: string,
    assignments: Array<{ slot: string | null; position: number }>,
    capacity: number,
): number | null {
    const occupied = new Set(
        assignments.filter((a) => a.slot === role).map((a) => a.position),
    );
    for (let pos = 1; pos <= capacity; pos++) {
        if (!occupied.has(pos)) return pos;
    }
    return null;
}

interface UseDayEventSignupOptions {
    eventId: number;
    hasGame: boolean;
    getTotalForRole: (role: string) => number;
    assignments: Array<{ slot: string | null; position: number }>;
    totalPlayerSlots: number;
    totalBenchSlots: number;
}

function showSignupError(err: unknown) {
    toast.error('Failed to sign up', { description: err instanceof Error ? err.message : 'Please try again.' });
}

async function performDirectSignup(
    signup: ReturnType<typeof useSignup>, slotInfo: { slotRole: string; slotPosition: number },
    invalidate: () => void, successMsg: string, successDesc: string,
) {
    try {
        await signup.mutateAsync(slotInfo);
        invalidate();
        toast.success(successMsg, { description: successDesc });
    } catch (err) { showSignupError(err); }
}

function findGenericSlot(assignments: Array<{ slot: string | null; position: number }>, totalPlayerSlots: number, totalBenchSlots: number) {
    let role = 'player';
    let nextPos = findNextAvailablePosition('player', assignments, totalPlayerSlots);
    if (!nextPos && totalBenchSlots > 0) { role = 'bench'; nextPos = findNextAvailablePosition('bench', assignments, totalBenchSlots); }
    return nextPos ? { role, nextPos } : null;
}

function useSignupModalState() {
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [pendingSlotInfo, setPendingSlotInfo] = useState<{ slotRole: string; slotPosition: number } | null>(null);
    const [pendingRole, setPendingRole] = useState<string | undefined>(undefined);
    const resetModal = () => { setShowConfirmModal(false); setPendingSlotInfo(null); setPendingRole(undefined); };
    const openModal = (slot: { slotRole: string; slotPosition: number }, role?: string) => {
        setPendingSlotInfo(slot); setPendingRole(role); setShowConfirmModal(true);
    };
    return { showConfirmModal, pendingSlotInfo, pendingRole, resetModal, openModal };
}

async function handleLeaveEvent(e: React.MouseEvent, cancelSignup: ReturnType<typeof useCancelSignup>, invalidate: () => void) {
    e.stopPropagation();
    try { await cancelSignup.mutateAsync(); invalidate(); toast.success('Signup cancelled', { description: 'You have been removed from the event.' }); }
    catch (err) { toast.error('Failed to cancel signup', { description: err instanceof Error ? err.message : 'Please try again.' }); }
}

async function confirmSignupWithCharacter(
    signup: ReturnType<typeof useSignup>, modal: ReturnType<typeof useSignupModalState>,
    invalidate: () => void, selection: { characterId: string; role?: CharacterRole },
) {
    if (!modal.pendingSlotInfo) return;
    try {
        await signup.mutateAsync({ ...modal.pendingSlotInfo, characterId: selection.characterId });
        invalidate();
        toast.success('Joined!', { description: modal.pendingRole ? `Signed up as ${ROLE_LABELS[modal.pendingRole] ?? modal.pendingRole}.` : 'You\'re on the roster!' });
        modal.resetModal();
    } catch (err) { showSignupError(err); }
}

async function confirmSignupSkip(signup: ReturnType<typeof useSignup>, modal: ReturnType<typeof useSignupModalState>, invalidate: () => void) {
    if (!modal.pendingSlotInfo) return;
    try { await signup.mutateAsync(modal.pendingSlotInfo); invalidate(); toast.success('Joined!', { description: 'Signed up without a character.' }); modal.resetModal(); }
    catch (err) { showSignupError(err); }
}

function createRoleJoinHandler(
    hasGame: boolean, getTotalForRole: (role: string) => number, assignments: Array<{ slot: string | null; position: number }>,
    signup: ReturnType<typeof useSignup>, modal: ReturnType<typeof useSignupModalState>, invalidate: () => void,
) {
    return async (e: React.MouseEvent, role: string) => {
        e.stopPropagation();
        const nextPos = findNextAvailablePosition(role, assignments, getTotalForRole(role));
        if (!nextPos) return;
        if (hasGame) { modal.openModal({ slotRole: role, slotPosition: nextPos }, role); return; }
        await performDirectSignup(signup, { slotRole: role, slotPosition: nextPos }, invalidate, `Joined ${ROLE_LABELS[role] ?? role}!`, `You're in slot ${nextPos}.`);
    };
}

function createGenericJoinHandler(
    hasGame: boolean, assignments: Array<{ slot: string | null; position: number }>,
    totalPlayerSlots: number, totalBenchSlots: number,
    signup: ReturnType<typeof useSignup>, modal: ReturnType<typeof useSignupModalState>, invalidate: () => void,
) {
    return async (e: React.MouseEvent) => {
        e.stopPropagation();
        const slot = findGenericSlot(assignments, totalPlayerSlots, totalBenchSlots);
        if (!slot) return;
        if (hasGame) { modal.openModal({ slotRole: slot.role, slotPosition: slot.nextPos }); return; }
        await performDirectSignup(signup, { slotRole: slot.role, slotPosition: slot.nextPos }, invalidate, 'Joined!', 'You\'re on the roster!');
    };
}

export function useDayEventSignup({
    eventId, hasGame, getTotalForRole, assignments, totalPlayerSlots, totalBenchSlots,
}: UseDayEventSignupOptions) {
    const queryClient = useQueryClient();
    const signup = useSignup(eventId);
    const cancelSignup = useCancelSignup(eventId);
    const modal = useSignupModalState();
    const invalidateCalendar = () => queryClient.invalidateQueries({ queryKey: ['events'] });

    return {
        signup, cancelSignup, isMutating: signup.isPending || cancelSignup.isPending,
        showConfirmModal: modal.showConfirmModal, pendingRole: modal.pendingRole,
        handleRoleJoin: createRoleJoinHandler(hasGame, getTotalForRole, assignments, signup, modal, invalidateCalendar),
        handleGenericJoin: createGenericJoinHandler(hasGame, assignments, totalPlayerSlots, totalBenchSlots, signup, modal, invalidateCalendar),
        handleLeave: (e: React.MouseEvent) => handleLeaveEvent(e, cancelSignup, invalidateCalendar),
        handleSignupConfirm: (sel: { characterId: string; role?: CharacterRole }) => confirmSignupWithCharacter(signup, modal, invalidateCalendar, sel),
        handleSignupSkip: () => confirmSignupSkip(signup, modal, invalidateCalendar),
        handleConfirmModalClose: modal.resetModal,
    };
}
