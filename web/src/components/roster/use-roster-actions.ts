import React from 'react';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { toast } from '../../lib/toast';
import type { AutoFillResult } from './roster-auto-fill';
import { computeAutoFill } from './roster-auto-fill';

interface RosterSlotConfig {
    role: RosterRole;
    count: number;
    label: string;
    color: string;
}

interface UseRosterActionsArgs {
    pool: RosterAssignmentResponse[];
    assignments: RosterAssignmentResponse[];
    onRosterChange: (pool: RosterAssignmentResponse[], assignments: RosterAssignmentResponse[], charMap?: Map<number, string>) => void;
    roleSlots: RosterSlotConfig[];
    getSlotCount: (role: RosterRole) => number;
    isGenericGame: boolean;
    announce: (msg: string) => void;
}

export function useRosterActions({
    pool, assignments, onRosterChange, roleSlots, getSlotCount, isGenericGame, announce,
}: UseRosterActionsArgs) {
    const [assignmentTarget, setAssignmentTarget] = React.useState<{
        role: RosterRole; position: number; occupant?: RosterAssignmentResponse;
    } | null>(null);
    const [browseAll, setBrowseAll] = React.useState(false);
    const [autoFillPreview, setAutoFillPreview] = React.useState<AutoFillResult | null>(null);
    const [clearPending, setClearPending] = React.useState(false);
    const [isBulkUpdating, setIsBulkUpdating] = React.useState(false);

    React.useEffect(() => {
        if (clearPending) { const t = setTimeout(() => setClearPending(false), 3000); return () => clearTimeout(t); }
    }, [clearPending]);

    const handleAdminSlotClick = (role: RosterRole, position: number) => {
        setAssignmentTarget({ role, position, occupant: assignments.find(a => a.slot === role && a.position === position) });
    };

    const handleAssign = (signupId: number, selection?: { characterId?: string; role?: RosterRole }) => {
        if (!assignmentTarget) return;
        const sourceItem = pool.find(p => p.signupId === signupId);
        if (!sourceItem) return;
        const newPool = pool.filter(p => p.signupId !== signupId);
        let newAssignments = [...assignments];
        if (assignmentTarget.occupant) {
            newAssignments = newAssignments.filter(a => a.signupId !== assignmentTarget.occupant!.signupId);
            newPool.push({ ...assignmentTarget.occupant, slot: null, position: 0 });
        }
        newAssignments.push({ ...sourceItem, slot: assignmentTarget.role, position: assignmentTarget.position, isOverride: sourceItem.character?.role !== assignmentTarget.role });
        const charMap = selection?.characterId ? new Map([[signupId, selection.characterId]]) : undefined;
        onRosterChange(newPool, newAssignments, charMap);
        const slotLabel = assignmentTarget.role === 'player' ? `slot ${assignmentTarget.position}` : `${assignmentTarget.role} ${assignmentTarget.position}`;
        const msg = `${sourceItem.username} assigned to ${slotLabel}`;
        toast.success(msg); announce(msg); setAssignmentTarget(null);
    };

    const handleRemoveFromSlot = (signupId: number) => {
        const sourceItem = assignments.find(a => a.signupId === signupId);
        if (!sourceItem) return;
        onRosterChange([...pool, { ...sourceItem, slot: null, position: 0 }], assignments.filter(a => a.signupId !== signupId));
        const msg = `${sourceItem.username} moved to unassigned`;
        toast.success(msg); announce(msg); setAssignmentTarget(null);
    };

    const handleClosePopup = () => { setAssignmentTarget(null); setBrowseAll(false); };

    const handleReassignToSlot = (fromSignupId: number, toRole: RosterRole, toPosition: number) => {
        const sourcePlayer = assignments.find(a => a.signupId === fromSignupId);
        if (!sourcePlayer) return;
        const targetPlayer = assignments.find(a => a.slot === toRole && a.position === toPosition);
        let newAssignments = [...assignments];
        if (targetPlayer) {
            newAssignments = newAssignments.map(a => {
                if (a.signupId === fromSignupId) return { ...a, slot: toRole, position: toPosition, isOverride: a.character?.role !== toRole };
                if (a.signupId === targetPlayer.signupId) return { ...a, slot: sourcePlayer.slot, position: sourcePlayer.position, isOverride: a.character?.role !== sourcePlayer.slot };
                return a;
            });
            const msg = `Swapped ${sourcePlayer.username} and ${targetPlayer.username}`;
            toast.success(msg); announce(msg);
        } else {
            newAssignments = newAssignments.map(a => {
                if (a.signupId === fromSignupId) return { ...a, slot: toRole, position: toPosition, isOverride: a.character?.role !== toRole };
                return a;
            });
            const roleLabel = toRole === 'player' ? `slot ${toPosition}` : `${toRole.charAt(0).toUpperCase() + toRole.slice(1)} ${toPosition}`;
            const msg = `${sourcePlayer.username} moved to ${roleLabel}`;
            toast.success(msg); announce(msg);
        }
        onRosterChange(pool, newAssignments); setAssignmentTarget(null);
    };

    const handleAssignToSlot = (signupId: number, role: RosterRole, position: number, selection?: { characterId?: string }) => {
        const sourceItem = pool.find(p => p.signupId === signupId);
        if (!sourceItem) return;
        const newAssignments = [...assignments, { ...sourceItem, slot: role, position, isOverride: sourceItem.character?.role !== role }];
        const charMap = selection?.characterId ? new Map([[signupId, selection.characterId]]) : undefined;
        onRosterChange(pool.filter(p => p.signupId !== signupId), newAssignments, charMap);
        const slotLabel = role === 'player' ? `slot ${position}` : `${role} ${position}`;
        const msg = `${sourceItem.username} assigned to ${slotLabel}`;
        toast.success(msg); announce(msg); setBrowseAll(false);
    };

    const handleAutoFillClick = () => {
        const result = computeAutoFill(pool, assignments, roleSlots, getSlotCount, isGenericGame);
        if (result.totalFilled === 0) { toast.info('No matching players to auto-fill'); return; }
        setAutoFillPreview(result);
    };

    const handleAutoFillConfirm = () => {
        if (!autoFillPreview) return;
        setIsBulkUpdating(true);
        try {
            onRosterChange(autoFillPreview.newPool, autoFillPreview.newAssignments);
            const msg = `Auto-filled ${autoFillPreview.totalFilled} players`;
            toast.success(msg); announce(msg);
        } finally { setAutoFillPreview(null); setIsBulkUpdating(false); }
    };

    const handleClearAllClick = () => {
        if (clearPending) {
            setClearPending(false); setIsBulkUpdating(true);
            try {
                onRosterChange([...pool, ...assignments.map(a => ({ ...a, slot: null, position: 0 }))], []);
                const msg = `Roster cleared — ${assignments.length} players moved to pool`;
                toast.success(msg); announce(msg);
            } finally { setIsBulkUpdating(false); }
        } else { setClearPending(true); }
    };

    return {
        assignmentTarget, setAssignmentTarget,
        browseAll, setBrowseAll,
        autoFillPreview, setAutoFillPreview,
        clearPending, isBulkUpdating,
        handleAdminSlotClick, handleAssign, handleRemoveFromSlot,
        handleClosePopup, handleReassignToSlot, handleAssignToSlot,
        handleAutoFillClick, handleAutoFillConfirm, handleClearAllClick,
    };
}
