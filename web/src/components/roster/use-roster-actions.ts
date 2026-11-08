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

/** `false` (or a rejection) means the save failed; anything else counts as saved. */
export type RosterChangeResult = boolean | void;

interface UseRosterActionsArgs {
    pool: RosterAssignmentResponse[];
    assignments: RosterAssignmentResponse[];
    onRosterChange: (pool: RosterAssignmentResponse[], assignments: RosterAssignmentResponse[], charMap?: Map<number, string>) => RosterChangeResult | Promise<RosterChangeResult>;
    roleSlots: RosterSlotConfig[];
    getSlotCount: (role: RosterRole) => number;
    isGenericGame: boolean;
    announce: (msg: string) => void;
}

/**
 * Runs a roster save and toasts/announces `msg` only once it has succeeded (ROK-2141).
 * A rejection gets an error toast; a `false` result means the caller already reported it.
 */
async function saveThenAnnounce(
    save: () => RosterChangeResult | Promise<RosterChangeResult>, msg: string, announce: (msg: string) => void,
): Promise<void> {
    try {
        if ((await save()) === false) return;
    } catch (err) {
        toast.error('Failed to update roster', { description: err instanceof Error ? err.message : 'Please try again.' });
        return;
    }
    toast.success(msg); announce(msg);
}

function formatSlotLabel(role: RosterRole, position: number) {
    return role === 'player' ? `slot ${position}` : `${role} ${position}`;
}

function buildReassignment(
    assignments: RosterAssignmentResponse[], fromSignupId: number,
    sourcePlayer: RosterAssignmentResponse, toRole: RosterRole, toPosition: number,
) {
    const targetPlayer = assignments.find(a => a.slot === toRole && a.position === toPosition);
    if (targetPlayer) {
        const updated = assignments.map(a => {
            if (a.signupId === fromSignupId) return { ...a, slot: toRole, position: toPosition, isOverride: a.character?.role !== toRole };
            if (a.signupId === targetPlayer.signupId) return { ...a, slot: sourcePlayer.slot, position: sourcePlayer.position, isOverride: a.character?.role !== sourcePlayer.slot };
            return a;
        });
        return { updated, msg: `Swapped ${sourcePlayer.username} and ${targetPlayer.username}` };
    }
    const updated = assignments.map(a => {
        if (a.signupId === fromSignupId) return { ...a, slot: toRole, position: toPosition, isOverride: a.character?.role !== toRole };
        return a;
    });
    const roleLabel = toRole === 'player' ? `slot ${toPosition}` : `${toRole.charAt(0).toUpperCase() + toRole.slice(1)} ${toPosition}`;
    return { updated, msg: `${sourcePlayer.username} moved to ${roleLabel}` };
}

interface RosterActionsState {
    assignmentTarget: { role: RosterRole; position: number; occupant?: RosterAssignmentResponse } | null;
    setAssignmentTarget: React.Dispatch<React.SetStateAction<RosterActionsState['assignmentTarget']>>;
    browseAll: boolean;
    setBrowseAll: React.Dispatch<React.SetStateAction<boolean>>;
    autoFillPreview: AutoFillResult | null;
    setAutoFillPreview: React.Dispatch<React.SetStateAction<AutoFillResult | null>>;
    clearPending: boolean;
    setClearPending: React.Dispatch<React.SetStateAction<boolean>>;
    isBulkUpdating: boolean;
    setIsBulkUpdating: React.Dispatch<React.SetStateAction<boolean>>;
}

function useRosterActionsState(): RosterActionsState {
    const [assignmentTarget, setAssignmentTarget] = React.useState<RosterActionsState['assignmentTarget']>(null);
    const [browseAll, setBrowseAll] = React.useState(false);
    const [autoFillPreview, setAutoFillPreview] = React.useState<AutoFillResult | null>(null);
    const [clearPending, setClearPending] = React.useState(false);
    const [isBulkUpdating, setIsBulkUpdating] = React.useState(false);

    React.useEffect(() => {
        if (clearPending) { const t = setTimeout(() => setClearPending(false), 3000); return () => clearTimeout(t); }
    }, [clearPending]);

    return { assignmentTarget, setAssignmentTarget, browseAll, setBrowseAll, autoFillPreview, setAutoFillPreview, clearPending, setClearPending, isBulkUpdating, setIsBulkUpdating };
}

function makeAssignHandler(args: UseRosterActionsArgs, state: RosterActionsState) {
    return (signupId: number, selection?: { characterId?: string; role?: RosterRole }) => {
        const target = state.assignmentTarget;
        if (!target) return;
        const sourceItem = args.pool.find(p => p.signupId === signupId);
        if (!sourceItem) return;
        const newPool = args.pool.filter(p => p.signupId !== signupId);
        let newAssignments = [...args.assignments];
        const occupant = target.occupant;
        if (occupant) {
            newAssignments = newAssignments.filter(a => a.signupId !== occupant.signupId);
            newPool.push({ ...occupant, slot: null, position: 0 });
        }
        newAssignments.push({ ...sourceItem, slot: target.role, position: target.position, isOverride: sourceItem.character?.role !== target.role });
        const charMap = selection?.characterId ? new Map([[signupId, selection.characterId]]) : undefined;
        const msg = `${sourceItem.username} assigned to ${formatSlotLabel(target.role, target.position)}`;
        state.setAssignmentTarget(null);
        void saveThenAnnounce(() => args.onRosterChange(newPool, newAssignments, charMap), msg, args.announce);
    };
}

function makeAssignToSlotHandler(args: UseRosterActionsArgs, state: RosterActionsState) {
    return (signupId: number, role: RosterRole, position: number, selection?: { characterId?: string }) => {
        const sourceItem = args.pool.find(p => p.signupId === signupId);
        if (!sourceItem) return;
        const newAssignments = [...args.assignments, { ...sourceItem, slot: role, position, isOverride: sourceItem.character?.role !== role }];
        const charMap = selection?.characterId ? new Map([[signupId, selection.characterId]]) : undefined;
        const msg = `${sourceItem.username} assigned to ${formatSlotLabel(role, position)}`;
        state.setBrowseAll(false);
        void saveThenAnnounce(() => args.onRosterChange(args.pool.filter(p => p.signupId !== signupId), newAssignments, charMap), msg, args.announce);
    };
}

function makeBulkHandlers(args: UseRosterActionsArgs, state: RosterActionsState) {
    const handleAutoFillClick = () => {
        const result = computeAutoFill(args.pool, args.assignments, args.roleSlots, args.getSlotCount, args.isGenericGame);
        if (result.totalFilled === 0) { toast.info('No matching players to auto-fill'); return; }
        state.setAutoFillPreview(result);
    };
    const handleAutoFillConfirm = () => {
        const preview = state.autoFillPreview;
        if (!preview) return;
        state.setIsBulkUpdating(true); state.setAutoFillPreview(null);
        const msg = `Auto-filled ${preview.totalFilled} players`;
        void saveThenAnnounce(() => args.onRosterChange(preview.newPool, preview.newAssignments), msg, args.announce)
            .finally(() => state.setIsBulkUpdating(false));
    };
    const handleClearAllClick = () => {
        if (!state.clearPending) { state.setClearPending(true); return; }
        state.setClearPending(false); state.setIsBulkUpdating(true);
        const msg = `Roster cleared — ${args.assignments.length} players moved to pool`;
        const newPool = [...args.pool, ...args.assignments.map(a => ({ ...a, slot: null, position: 0 }))];
        void saveThenAnnounce(() => args.onRosterChange(newPool, []), msg, args.announce)
            .finally(() => state.setIsBulkUpdating(false));
    };
    return { handleAutoFillClick, handleAutoFillConfirm, handleClearAllClick };
}

export function useRosterActions(args: UseRosterActionsArgs) {
    const state = useRosterActionsState();

    const handleAdminSlotClick = (role: RosterRole, position: number) => {
        const occupant = args.assignments.find(a => a.slot === role && a.position === position);
        state.setAssignmentTarget({ role, position, ...(occupant ? { occupant } : {}) });
    };

    const handleRemoveFromSlot = (signupId: number) => {
        const sourceItem = args.assignments.find(a => a.signupId === signupId);
        if (!sourceItem) return;
        const msg = `${sourceItem.username} moved to unassigned`;
        state.setAssignmentTarget(null);
        void saveThenAnnounce(() => args.onRosterChange([...args.pool, { ...sourceItem, slot: null, position: 0 }], args.assignments.filter(a => a.signupId !== signupId)), msg, args.announce);
    };

    const handleReassignToSlot = (fromSignupId: number, toRole: RosterRole, toPosition: number) => {
        const sourcePlayer = args.assignments.find(a => a.signupId === fromSignupId);
        if (!sourcePlayer) return;
        const { updated, msg } = buildReassignment(args.assignments, fromSignupId, sourcePlayer, toRole, toPosition);
        state.setAssignmentTarget(null);
        void saveThenAnnounce(() => args.onRosterChange(args.pool, updated), msg, args.announce);
    };

    const bulk = makeBulkHandlers(args, state);

    return {
        ...state, handleAdminSlotClick, handleAssign: makeAssignHandler(args, state),
        handleRemoveFromSlot, handleClosePopup: () => { state.setAssignmentTarget(null); state.setBrowseAll(false); },
        handleReassignToSlot, handleAssignToSlot: makeAssignToSlotHandler(args, state), ...bulk,
    };
}
