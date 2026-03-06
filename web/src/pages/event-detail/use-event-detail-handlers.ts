import { useState, useCallback } from 'react';
import { toast } from '../../lib/toast';
import { useSignup, useCancelSignup, useUpdateSignupStatus } from '../../hooks/use-signups';
import { useUpdateRoster, useSelfUnassign, useAdminRemoveUser, buildRosterUpdate } from '../../hooks/use-roster';
import { useUpdateAutoUnbench } from '../../hooks/use-auto-unbench';
import { useCreatePug, useDeletePug, usePugs, useRegeneratePugInviteCode } from '../../hooks/use-pugs';
import type { RosterAssignmentResponse, RosterRole, PugRole, CharacterRole } from '@raid-ledger/contract';

/**
 * Custom hook encapsulating all event detail page handler logic.
 * Extracts signup, roster, PUG, and admin removal handlers.
 */
export function useEventDetailHandlers(eventId: number, options: {
    canManageRoster: boolean;
    isAuthenticated: boolean;
    shouldShowCharacterModal: boolean;
}) {
    const signup = useSignup(eventId);
    const cancelSignup = useCancelSignup(eventId);
    const updateStatus = useUpdateSignupStatus(eventId);
    const updateRoster = useUpdateRoster(eventId);
    const selfUnassign = useSelfUnassign(eventId);
    const updateAutoUnbench = useUpdateAutoUnbench(eventId);
    const createPug = useCreatePug(eventId);
    const deletePug = useDeletePug(eventId);
    const regeneratePugCode = useRegeneratePugInviteCode(eventId);
    const adminRemoveUser = useAdminRemoveUser(eventId);
    const { data: pugData } = usePugs(eventId);
    const pugs = pugData?.pugs ?? [];

    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [preSelectedRole, setPreSelectedRole] = useState<CharacterRole | undefined>(undefined);
    const [pendingSlot, setPendingSlot] = useState<{ role: RosterRole; position: number } | null>(null);
    const [removeConfirm, setRemoveConfirm] = useState<{ signupId: number; username: string } | null>(null);

    /** Perform actual signup API call */
    const doSignup = useCallback(async (
        opts?: { characterId?: string; slotRole?: string; slotPosition?: number; preferredRoles?: string[] },
    ) => {
        try {
            await signup.mutateAsync(opts);
            toast.success('Successfully signed up!', { description: "You're on the roster!" });
        } catch (err) {
            toast.error('Failed to sign up', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    }, [signup]);

    /** Initiate signup flow -- may open modal or go direct */
    const handleSignup = useCallback(() => {
        if (options.shouldShowCharacterModal) {
            setPreSelectedRole(undefined);
            setPendingSlot(null);
            setShowConfirmModal(true);
            return;
        }
        doSignup();
    }, [options.shouldShowCharacterModal, doSignup]);

    /** Handle selection confirm from modal */
    const handleSelectionConfirm = useCallback(async (
        selection: { characterId: string; role?: CharacterRole; preferredRoles?: CharacterRole[] },
    ) => {
        try {
            const opts: { characterId: string; slotRole?: string; slotPosition?: number; preferredRoles?: string[] } = {
                characterId: selection.characterId,
            };
            if (selection.preferredRoles && selection.preferredRoles.length > 0) {
                opts.preferredRoles = selection.preferredRoles;
            }
            if (pendingSlot) {
                opts.slotRole = selection.role ?? pendingSlot.role;
                opts.slotPosition = pendingSlot.position;
            } else if (selection.preferredRoles?.length === 1) {
                opts.slotRole = selection.preferredRoles[0];
            } else if (!selection.preferredRoles && selection.role) {
                opts.slotRole = selection.role;
            }
            await signup.mutateAsync(opts);
            setShowConfirmModal(false);
            setPendingSlot(null);
            setPreSelectedRole(undefined);
            toast.success('Successfully signed up!', { description: "You're on the roster!" });
        } catch (err) {
            toast.error('Failed to sign up', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    }, [pendingSlot, signup]);

    /** Handle skip from modal (no characters) */
    const handleSelectionSkip = useCallback(async (
        skipOpts?: { preferredRoles?: CharacterRole[] },
    ) => {
        try {
            const opts: { slotRole?: string; slotPosition?: number; preferredRoles?: string[] } = {};
            if (pendingSlot) {
                opts.slotRole = pendingSlot.role;
                opts.slotPosition = pendingSlot.position;
            }
            if (skipOpts?.preferredRoles && skipOpts.preferredRoles.length > 0) {
                opts.preferredRoles = skipOpts.preferredRoles;
                if (!opts.slotRole && skipOpts.preferredRoles.length === 1) {
                    opts.slotRole = skipOpts.preferredRoles[0];
                }
            }
            await signup.mutateAsync(Object.keys(opts).length > 0 ? opts : undefined);
            setShowConfirmModal(false);
            setPendingSlot(null);
            setPreSelectedRole(undefined);
            toast.success('Successfully signed up!', { description: "You're on the roster!" });
        } catch (err) {
            toast.error('Failed to sign up', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    }, [pendingSlot, signup]);

    /** Cancel signup */
    const handleCancel = useCallback(async () => {
        try {
            await cancelSignup.mutateAsync();
            toast.success('Signup cancelled', { description: 'You have been removed from the roster.' });
        } catch (err) {
            toast.error('Failed to cancel signup', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    }, [cancelSignup]);

    /** Self-unassign from roster slot */
    const handleSelfRemove = useCallback(async () => {
        if (selfUnassign.isPending) return;
        try {
            await selfUnassign.mutateAsync();
            signup.reset();
            toast.success('Left roster slot', { description: "You're still signed up but moved to unassigned." });
        } catch (err) {
            toast.error('Failed to leave slot', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    }, [selfUnassign, signup]);

    /** Roster change handler for admin drag-and-drop */
    const handleRosterChange = useCallback(async (
        pool: RosterAssignmentResponse[],
        assignments: RosterAssignmentResponse[],
        characterIdMap?: Map<number, string>,
    ) => {
        if (!options.canManageRoster) {
            toast.error('Permission denied', {
                description: 'Only the event creator, admin, or operator can update the roster.',
            });
            return;
        }
        try {
            await updateRoster.mutateAsync(buildRosterUpdate(pool, assignments, characterIdMap));
        } catch (err) {
            toast.error('Failed to update roster', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    }, [options.canManageRoster, updateRoster]);

    /** Generate PUG invite link */
    const handleGenerateInviteLink = useCallback(async (role: RosterRole) => {
        try {
            const pugSlot = await createPug.mutateAsync({ role: role as PugRole });
            if (!pugSlot.inviteCode) {
                toast.error('Failed to generate invite link', { description: 'No invite code returned.' });
                return;
            }
            const inviteUrl = `${window.location.origin}/i/${pugSlot.inviteCode}`;
            await navigator.clipboard.writeText(inviteUrl);
            toast.success('Invite link copied to clipboard!', { description: inviteUrl });
        } catch (err) {
            toast.error('Failed to generate invite link', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    }, [createPug]);

    /** Remove PUG invite */
    const handleRemovePug = useCallback(async (pugId: string) => {
        try {
            await deletePug.mutateAsync(pugId);
            toast.success('Invite cancelled');
        } catch (err) {
            toast.error('Failed to cancel invite', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    }, [deletePug]);

    /** Regenerate PUG invite link */
    const handleRegeneratePugLink = useCallback(async (pugId: string) => {
        try {
            const updated = await regeneratePugCode.mutateAsync(pugId);
            if (updated.inviteCode) {
                const url = `${window.location.origin}/i/${updated.inviteCode}`;
                await navigator.clipboard.writeText(url);
                toast.success('New invite link copied to clipboard!');
            }
        } catch (err) {
            toast.error('Failed to regenerate link', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    }, [regeneratePugCode]);

    /** Slot click handler */
    const handleSlotClick = useCallback((role: RosterRole, position: number) => {
        if (!options.isAuthenticated || signup.isPending) return;
        if (role === 'bench') {
            doSignup({ slotRole: 'bench', slotPosition: position });
            return;
        }
        if (options.shouldShowCharacterModal) {
            const mmoRoles: string[] = ['tank', 'healer', 'dps'];
            setPreSelectedRole(mmoRoles.includes(role) ? (role as CharacterRole) : undefined);
            setPendingSlot({ role, position });
            setShowConfirmModal(true);
            return;
        }
        doSignup({ slotRole: role, slotPosition: position, preferredRoles: [role] });
    }, [options.isAuthenticated, options.shouldShowCharacterModal, signup.isPending, doSignup]);

    /** Open remove confirmation */
    const handleRemoveFromEvent = useCallback((signupId: number, username: string) => {
        setRemoveConfirm({ signupId, username });
    }, []);

    /** Confirmed removal */
    const handleConfirmRemoveFromEvent = useCallback(async () => {
        if (!removeConfirm) return;
        try {
            await adminRemoveUser.mutateAsync(removeConfirm.signupId);
            toast.success(`${removeConfirm.username} removed from event`);
            setRemoveConfirm(null);
        } catch (err) {
            toast.error('Failed to remove user', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    }, [removeConfirm, adminRemoveUser]);

    /** Close the confirm modal */
    const closeConfirmModal = useCallback(() => {
        setShowConfirmModal(false);
        setPendingSlot(null);
        setPreSelectedRole(undefined);
    }, []);

    return {
        signup,
        cancelSignup,
        updateStatus,
        updateAutoUnbench,
        pugs,
        showConfirmModal,
        preSelectedRole,
        removeConfirm,
        setRemoveConfirm,
        handleSignup,
        handleSelectionConfirm,
        handleSelectionSkip,
        handleCancel,
        handleSelfRemove,
        handleRosterChange,
        handleGenerateInviteLink,
        handleRemovePug,
        handleRegeneratePugLink,
        handleSlotClick,
        handleRemoveFromEvent,
        handleConfirmRemoveFromEvent,
        closeConfirmModal,
        adminRemoveUser,
        doSignup,
    };
}
