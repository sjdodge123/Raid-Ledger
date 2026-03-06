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

export function useDayEventSignup({
    eventId, hasGame, getTotalForRole, assignments, totalPlayerSlots, totalBenchSlots,
}: UseDayEventSignupOptions) {
    const queryClient = useQueryClient();
    const signup = useSignup(eventId);
    const cancelSignup = useCancelSignup(eventId);

    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [pendingSlotInfo, setPendingSlotInfo] = useState<{ slotRole: string; slotPosition: number } | null>(null);
    const [pendingRole, setPendingRole] = useState<string | undefined>(undefined);

    const invalidateCalendar = () => {
        queryClient.invalidateQueries({ queryKey: ['events'] });
    };

    const handleRoleJoin = async (e: React.MouseEvent, role: string) => {
        e.stopPropagation();
        const capacity = getTotalForRole(role);
        const nextPos = findNextAvailablePosition(role, assignments, capacity);
        if (!nextPos) return;

        if (hasGame) {
            setPendingSlotInfo({ slotRole: role, slotPosition: nextPos });
            setPendingRole(role);
            setShowConfirmModal(true);
            return;
        }

        try {
            await signup.mutateAsync({ slotRole: role, slotPosition: nextPos });
            invalidateCalendar();
            toast.success(`Joined ${ROLE_LABELS[role] ?? role}!`, { description: `You're in slot ${nextPos}.` });
        } catch (err) {
            toast.error('Failed to sign up', { description: err instanceof Error ? err.message : 'Please try again.' });
        }
    };

    const handleGenericJoin = async (e: React.MouseEvent) => {
        e.stopPropagation();
        let role = 'player';
        let nextPos = findNextAvailablePosition('player', assignments, totalPlayerSlots);
        if (!nextPos && totalBenchSlots > 0) {
            role = 'bench';
            nextPos = findNextAvailablePosition('bench', assignments, totalBenchSlots);
        }
        if (!nextPos) return;

        if (hasGame) {
            setPendingSlotInfo({ slotRole: role, slotPosition: nextPos });
            setPendingRole(undefined);
            setShowConfirmModal(true);
            return;
        }

        try {
            await signup.mutateAsync({ slotRole: role, slotPosition: nextPos });
            invalidateCalendar();
            toast.success('Joined!', { description: 'You\'re on the roster!' });
        } catch (err) {
            toast.error('Failed to sign up', { description: err instanceof Error ? err.message : 'Please try again.' });
        }
    };

    const handleLeave = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await cancelSignup.mutateAsync();
            invalidateCalendar();
            toast.success('Signup cancelled', { description: 'You have been removed from the event.' });
        } catch (err) {
            toast.error('Failed to cancel signup', { description: err instanceof Error ? err.message : 'Please try again.' });
        }
    };

    const handleSignupConfirm = async (selection: { characterId: string; role?: CharacterRole }) => {
        if (!pendingSlotInfo) return;
        try {
            await signup.mutateAsync({ ...pendingSlotInfo, characterId: selection.characterId });
            invalidateCalendar();
            toast.success('Joined!', {
                description: pendingRole ? `Signed up as ${ROLE_LABELS[pendingRole] ?? pendingRole}.` : 'You\'re on the roster!',
            });
            setShowConfirmModal(false);
            setPendingSlotInfo(null);
            setPendingRole(undefined);
        } catch (err) {
            toast.error('Failed to sign up', { description: err instanceof Error ? err.message : 'Please try again.' });
        }
    };

    const handleSignupSkip = async () => {
        if (!pendingSlotInfo) return;
        try {
            await signup.mutateAsync(pendingSlotInfo);
            invalidateCalendar();
            toast.success('Joined!', { description: 'Signed up without a character.' });
            setShowConfirmModal(false);
            setPendingSlotInfo(null);
            setPendingRole(undefined);
        } catch (err) {
            toast.error('Failed to sign up', { description: err instanceof Error ? err.message : 'Please try again.' });
        }
    };

    const handleConfirmModalClose = () => {
        setShowConfirmModal(false);
        setPendingSlotInfo(null);
        setPendingRole(undefined);
    };

    const isMutating = signup.isPending || cancelSignup.isPending;

    return {
        signup, cancelSignup, isMutating,
        showConfirmModal, pendingRole,
        handleRoleJoin, handleGenericJoin, handleLeave,
        handleSignupConfirm, handleSignupSkip, handleConfirmModalClose,
    };
}
