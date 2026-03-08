import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../../lib/toast';
import { useSignup, useCancelSignup, useUpdateSignupStatus } from '../../hooks/use-signups';
import { useUpdateRoster, useSelfUnassign, useAdminRemoveUser, buildRosterUpdate } from '../../hooks/use-roster';
import { useUpdateAutoUnbench } from '../../hooks/use-auto-unbench';
import { useCreatePug, useDeletePug, usePugs, useRegeneratePugInviteCode } from '../../hooks/use-pugs';
import { useDeleteEvent, useDeleteSeries, useCancelSeries } from '../../hooks/use-events';
import type { RosterAssignmentResponse, RosterRole, PugRole, CharacterRole, SeriesScope } from '@raid-ledger/contract';
import { getSignupToast } from './signup-toast.helpers';

/**
 * Custom hook encapsulating all event detail page handler logic.
 * Extracts signup, roster, PUG, and admin removal handlers.
 */
function buildConfirmOpts(selection: { characterId: string; role?: CharacterRole; preferredRoles?: CharacterRole[] }, pendingSlot: { role: RosterRole; position: number } | null) {
    const opts: { characterId: string; slotRole?: string; slotPosition?: number; preferredRoles?: string[] } = { characterId: selection.characterId };
    if (selection.preferredRoles?.length) opts.preferredRoles = selection.preferredRoles;
    if (pendingSlot) { opts.slotRole = selection.role ?? pendingSlot.role; opts.slotPosition = pendingSlot.position; }
    else if (selection.preferredRoles?.length === 1) opts.slotRole = selection.preferredRoles[0];
    else if (!selection.preferredRoles && selection.role) opts.slotRole = selection.role;
    return opts;
}

function buildSkipOpts(pendingSlot: { role: RosterRole; position: number } | null, skipOpts?: { preferredRoles?: CharacterRole[] }) {
    const opts: { slotRole?: string; slotPosition?: number; preferredRoles?: string[] } = {};
    if (pendingSlot) { opts.slotRole = pendingSlot.role; opts.slotPosition = pendingSlot.position; }
    if (skipOpts?.preferredRoles?.length) {
        opts.preferredRoles = skipOpts.preferredRoles;
        if (!opts.slotRole && skipOpts.preferredRoles.length === 1) opts.slotRole = skipOpts.preferredRoles[0];
    }
    return Object.keys(opts).length > 0 ? opts : undefined;
}

function useSignupHandlers(eventId: number, options: { shouldShowCharacterModal: boolean }) {
    const signup = useSignup(eventId);
    const cancelSignup = useCancelSignup(eventId);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [preSelectedRole, setPreSelectedRole] = useState<CharacterRole | undefined>(undefined);
    const [pendingSlot, setPendingSlot] = useState<{ role: RosterRole; position: number } | null>(null);

    const resetModal = useCallback(() => { setShowConfirmModal(false); setPendingSlot(null); setPreSelectedRole(undefined); }, []);

    const doSignup = useCallback(async (opts?: { characterId?: string; slotRole?: string; slotPosition?: number; preferredRoles?: string[] }) => {
        try { const result = await signup.mutateAsync(opts); const t = getSignupToast(result.assignedSlot); toast.success(t.title, { description: t.description }); }
        catch (err) { toast.error('Failed to sign up', { description: err instanceof Error ? err.message : 'Please try again.' }); }
    }, [signup]);

    const handleSignup = useCallback(() => {
        if (options.shouldShowCharacterModal) { setPreSelectedRole(undefined); setPendingSlot(null); setShowConfirmModal(true); return; }
        doSignup();
    }, [options.shouldShowCharacterModal, doSignup]);

    const handleSelectionConfirm = useCallback(async (selection: { characterId: string; role?: CharacterRole; preferredRoles?: CharacterRole[] }) => {
        try { const result = await signup.mutateAsync(buildConfirmOpts(selection, pendingSlot)); resetModal(); const t = getSignupToast(result.assignedSlot); toast.success(t.title, { description: t.description }); }
        catch (err) { toast.error('Failed to sign up', { description: err instanceof Error ? err.message : 'Please try again.' }); }
    }, [pendingSlot, signup, resetModal]);

    const handleSelectionSkip = useCallback(async (skipOpts?: { preferredRoles?: CharacterRole[] }) => {
        try { const result = await signup.mutateAsync(buildSkipOpts(pendingSlot, skipOpts)); resetModal(); const t = getSignupToast(result.assignedSlot); toast.success(t.title, { description: t.description }); }
        catch (err) { toast.error('Failed to sign up', { description: err instanceof Error ? err.message : 'Please try again.' }); }
    }, [pendingSlot, signup, resetModal]);

    const handleCancel = useCallback(async () => {
        try { await cancelSignup.mutateAsync(); toast.success('Signup cancelled', { description: 'You have been removed from the roster.' }); }
        catch (err) { toast.error('Failed to cancel signup', { description: err instanceof Error ? err.message : 'Please try again.' }); }
    }, [cancelSignup]);

    return { signup, cancelSignup, showConfirmModal, preSelectedRole, pendingSlot, doSignup, handleSignup, handleSelectionConfirm, handleSelectionSkip, handleCancel,
        closeConfirmModal: resetModal, setPreSelectedRole, setPendingSlot, setShowConfirmModal };
}

function usePugHandlers(eventId: number) {
    const createPug = useCreatePug(eventId);
    const deletePug = useDeletePug(eventId);
    const regeneratePugCode = useRegeneratePugInviteCode(eventId);
    const { data: pugData } = usePugs(eventId);

    const handleGenerateInviteLink = useCallback(async (role: RosterRole) => {
        try {
            const pugSlot = await createPug.mutateAsync({ role: role as PugRole });
            if (!pugSlot.inviteCode) { toast.error('Failed to generate invite link', { description: 'No invite code returned.' }); return; }
            const inviteUrl = `${window.location.origin}/i/${pugSlot.inviteCode}`;
            await navigator.clipboard.writeText(inviteUrl);
            toast.success('Invite link copied to clipboard!', { description: inviteUrl });
        } catch (err) { toast.error('Failed to generate invite link', { description: err instanceof Error ? err.message : 'Please try again.' }); }
    }, [createPug]);

    const handleRemovePug = useCallback(async (pugId: string) => {
        try { await deletePug.mutateAsync(pugId); toast.success('Invite cancelled'); }
        catch (err) { toast.error('Failed to cancel invite', { description: err instanceof Error ? err.message : 'Please try again.' }); }
    }, [deletePug]);

    const handleRegeneratePugLink = useCallback(async (pugId: string) => {
        try {
            const updated = await regeneratePugCode.mutateAsync(pugId);
            if (updated.inviteCode) { await navigator.clipboard.writeText(`${window.location.origin}/i/${updated.inviteCode}`); toast.success('New invite link copied to clipboard!'); }
        } catch (err) { toast.error('Failed to regenerate link', { description: err instanceof Error ? err.message : 'Please try again.' }); }
    }, [regeneratePugCode]);

    return { pugs: pugData?.pugs ?? [], handleGenerateInviteLink, handleRemovePug, handleRegeneratePugLink };
}

function useRosterHandlers(eventId: number, canManageRoster: boolean, signupHandlers: ReturnType<typeof useSignupHandlers>) {
    const updateRoster = useUpdateRoster(eventId);
    const selfUnassign = useSelfUnassign(eventId);

    const handleSelfRemove = useCallback(async () => {
        if (selfUnassign.isPending) return;
        try { await selfUnassign.mutateAsync(); signupHandlers.signup.reset(); toast.success('Left roster slot', { description: "You're still signed up but moved to unassigned." }); }
        catch (err) { toast.error('Failed to leave slot', { description: err instanceof Error ? err.message : 'Please try again.' }); }
    }, [selfUnassign, signupHandlers.signup]);

    const handleRosterChange = useCallback(async (pool: RosterAssignmentResponse[], assignments: RosterAssignmentResponse[], characterIdMap?: Map<number, string>) => {
        if (!canManageRoster) { toast.error('Permission denied', { description: 'Only the event creator, admin, or operator can update the roster.' }); return; }
        try { await updateRoster.mutateAsync(buildRosterUpdate(pool, assignments, characterIdMap)); }
        catch (err) { toast.error('Failed to update roster', { description: err instanceof Error ? err.message : 'Please try again.' }); }
    }, [canManageRoster, updateRoster]);

    return { handleSelfRemove, handleRosterChange };
}

function useSlotClickHandler(options: { isAuthenticated: boolean; shouldShowCharacterModal: boolean }, signupHandlers: ReturnType<typeof useSignupHandlers>) {
    return useCallback((role: RosterRole, position: number) => {
        if (!options.isAuthenticated || signupHandlers.signup.isPending) return;
        if (role === 'bench') { signupHandlers.doSignup({ slotRole: 'bench', slotPosition: position }); return; }
        if (options.shouldShowCharacterModal) {
            const mmoRoles: string[] = ['tank', 'healer', 'dps'];
            signupHandlers.setPreSelectedRole(mmoRoles.includes(role) ? (role as CharacterRole) : undefined);
            signupHandlers.setPendingSlot({ role, position }); signupHandlers.setShowConfirmModal(true); return;
        }
        signupHandlers.doSignup({ slotRole: role, slotPosition: position, preferredRoles: [role] });
    }, [options.isAuthenticated, options.shouldShowCharacterModal, signupHandlers]);
}

function useSeriesHandlers(eventId: number) {
    const navigate = useNavigate();
    const deleteEvent = useDeleteEvent(eventId);
    const deleteSeries = useDeleteSeries(eventId);
    const cancelSeries = useCancelSeries(eventId);

    const handleDelete = useCallback(async () => {
        try { await deleteEvent.mutateAsync(); toast.success('Event deleted'); navigate('/calendar'); }
        catch (err) { toast.error('Failed to delete', { description: err instanceof Error ? err.message : 'Please try again.' }); }
    }, [deleteEvent, navigate]);

    const handleSeriesConfirm = useCallback(async (action: 'edit' | 'delete' | 'cancel', scope: SeriesScope) => {
        if (action === 'edit') { navigate(`/events/${eventId}/edit?seriesScope=${scope}`); return; }
        try {
            if (action === 'delete') { await deleteSeries.mutateAsync(scope); toast.success('Series deleted'); navigate('/calendar'); }
            else { await cancelSeries.mutateAsync({ scope }); toast.success('Series cancelled'); }
        } catch (err) { toast.error(`Failed to ${action} series`, { description: err instanceof Error ? err.message : 'Please try again.' }); }
    }, [eventId, navigate, deleteSeries, cancelSeries]);

    const isSeriesPending = deleteSeries.isPending || cancelSeries.isPending;

    return { handleDelete, handleSeriesConfirm, isSeriesPending };
}

export function useEventDetailHandlers(eventId: number, options: {
    canManageRoster: boolean; isAuthenticated: boolean; shouldShowCharacterModal: boolean;
}) {
    const signupHandlers = useSignupHandlers(eventId, options);
    const updateStatus = useUpdateSignupStatus(eventId);
    const updateAutoUnbench = useUpdateAutoUnbench(eventId);
    const adminRemoveUser = useAdminRemoveUser(eventId);
    const pugHandlers = usePugHandlers(eventId);
    const [removeConfirm, setRemoveConfirm] = useState<{ signupId: number; username: string } | null>(null);
    const rosterHandlers = useRosterHandlers(eventId, options.canManageRoster, signupHandlers);
    const handleSlotClick = useSlotClickHandler(options, signupHandlers);
    const seriesHandlers = useSeriesHandlers(eventId);

    const handleConfirmRemoveFromEvent = useCallback(async () => {
        if (!removeConfirm) return;
        try { await adminRemoveUser.mutateAsync(removeConfirm.signupId); toast.success(`${removeConfirm.username} removed from event`); setRemoveConfirm(null); }
        catch (err) { toast.error('Failed to remove user', { description: err instanceof Error ? err.message : 'Please try again.' }); }
    }, [removeConfirm, adminRemoveUser]);

    return {
        ...signupHandlers, updateStatus, updateAutoUnbench, ...pugHandlers,
        removeConfirm, setRemoveConfirm, adminRemoveUser,
        ...rosterHandlers, handleSlotClick,
        handleRemoveFromEvent: useCallback((signupId: number, username: string) => setRemoveConfirm({ signupId, username }), []),
        handleConfirmRemoveFromEvent,
        ...seriesHandlers,
    };
}
