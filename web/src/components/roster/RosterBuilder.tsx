import React from 'react';
import { toast } from '../../lib/toast';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { RosterSlot } from './RosterSlot';
import { UnassignedBar } from './UnassignedBar';
import { AssignmentPopup } from './AssignmentPopup';
import type { AvailableSlot } from './AssignmentPopup';
import { Modal } from '../ui/modal';
import { computeAutoFill } from './roster-auto-fill';
import type { AutoFillResult } from './roster-auto-fill';

interface RosterBuilderProps {
    /** Unassigned users (pool) */
    pool: RosterAssignmentResponse[];
    /** Assigned users with slot info */
    assignments: RosterAssignmentResponse[];
    /** Slot configuration (counts per role) */
    slots?: {
        tank?: number;
        healer?: number;
        dps?: number;
        flex?: number;
        player?: number;  // ROK-183: Generic player slots
        bench?: number;   // ROK-183: Overflow slots
    };
    /** Called when roster changes */
    onRosterChange: (
        pool: RosterAssignmentResponse[],
        assignments: RosterAssignmentResponse[],
    ) => void;
    /** Whether the user can edit (creator/admin) */
    canEdit: boolean;
    /** ROK-183: Called when non-admin clicks empty slot to join */
    onSlotClick?: (role: RosterRole, position: number) => void;
    /** ROK-183: Whether current user can click to join (authenticated + not signed up) */
    canJoin?: boolean;
    /** ROK-184: Current user ID for highlighting their slot */
    currentUserId?: number;
    /** ROK-226: Called when current user self-unassigns from their roster slot */
    onSelfRemove?: () => void;
    /** Optional extra content rendered alongside the UnassignedBar in a shared sticky row */
    stickyExtra?: React.ReactNode;
}

// MMO-style role slots
const MMO_ROLE_SLOTS: { role: RosterRole; count: number; label: string; color: string }[] = [
    { role: 'tank', count: 2, label: 'Tank', color: 'bg-blue-600' },
    { role: 'healer', count: 4, label: 'Healer', color: 'bg-green-600' },
    { role: 'dps', count: 14, label: 'DPS', color: 'bg-red-600' },
    { role: 'flex', count: 5, label: 'Flex', color: 'bg-purple-600' },
];

// ROK-183: Generic game slots
const GENERIC_ROLE_SLOTS: { role: RosterRole; count: number; label: string; color: string }[] = [
    { role: 'player', count: 4, label: 'Player', color: 'bg-indigo-600' },
];

// Bench slot config
const BENCH_SLOT: { role: RosterRole; count: number; label: string; color: string } =
    { role: 'bench', count: 0, label: 'Bench', color: 'bg-faint' };

/**
 * RosterBuilder - Click-to-assign roster component (ROK-208).
 * Supports MMO-style role slots and generic player slots.
 * Admins click slots to open assignment popup. Regular users double-click to join.
 */
export function RosterBuilder({
    pool,
    assignments,
    slots,
    onRosterChange,
    canEdit,
    onSlotClick,
    canJoin = false,
    currentUserId,
    onSelfRemove,
    stickyExtra,
}: RosterBuilderProps) {
    // ROK-208: Assignment popup state
    const [assignmentTarget, setAssignmentTarget] = React.useState<{
        role: RosterRole;
        position: number;
        occupant?: RosterAssignmentResponse;
    } | null>(null);

    // ROK-208: Browse-all mode (clicking the unassigned bar)
    const [browseAll, setBrowseAll] = React.useState(false);

    // Pending slot state for double-click Join flow.
    // Stored in RosterBuilder (not RosterSlot) so it survives background
    // React Query refetches that can remount child slot components.
    const [pendingSlotKey, setPendingSlotKey] = React.useState<string | null>(null);

    // Auto-reset pending state after 3 seconds
    React.useEffect(() => {
        if (pendingSlotKey) {
            const timeout = setTimeout(() => setPendingSlotKey(null), 3000);
            return () => clearTimeout(timeout);
        }
    }, [pendingSlotKey]);

    // ROK-209: Auto-fill and clear-all state
    const [autoFillPreview, setAutoFillPreview] = React.useState<AutoFillResult | null>(null);
    const [clearPending, setClearPending] = React.useState(false);
    const [isBulkUpdating, setIsBulkUpdating] = React.useState(false);

    // ROK-209: Auto-reset clearPending after 3s
    React.useEffect(() => {
        if (clearPending) {
            const timeout = setTimeout(() => setClearPending(false), 3000);
            return () => clearTimeout(timeout);
        }
    }, [clearPending]);

    // ROK-183: Detect if this is a generic game (has player slots, no MMO roles)
    const isGenericGame = React.useMemo(() => {
        if (!slots) return false;
        const hasPlayerSlots = (slots.player ?? 0) > 0;
        const hasMMORoles = (slots.tank ?? 0) > 0 || (slots.healer ?? 0) > 0 ||
            (slots.dps ?? 0) > 0 || (slots.flex ?? 0) > 0;
        return hasPlayerSlots && !hasMMORoles;
    }, [slots]);

    // Get role slots to render based on game type
    const roleSlots = React.useMemo(() => {
        const result = isGenericGame ? [...GENERIC_ROLE_SLOTS] : [...MMO_ROLE_SLOTS];
        // Add bench if configured
        if (slots?.bench && slots.bench > 0) {
            result.push({ ...BENCH_SLOT, count: slots.bench });
        }
        return result;
    }, [isGenericGame, slots]);

    // Get slot counts (use default or custom)
    const getSlotCount = React.useCallback((role: RosterRole): number => {
        if (slots?.[role] !== undefined) return slots[role]!;
        return roleSlots.find((s) => s.role === role)?.count ?? 0;
    }, [slots, roleSlots]);

    // ROK-208: Admin clicks a slot to open assignment popup
    const handleAdminSlotClick = (role: RosterRole, position: number) => {
        const occupant = assignments.find(a => a.slot === role && a.position === position);
        setAssignmentTarget({ role, position, occupant });
    };

    // ROK-208: Assign a player from popup to slot
    const handleAssign = (signupId: number) => {
        if (!assignmentTarget) return;
        const sourceItem = pool.find(p => p.signupId === signupId);
        if (!sourceItem) return;

        const newPool = pool.filter(p => p.signupId !== signupId);
        let newAssignments = [...assignments];

        // If slot occupied, swap occupant back to pool
        if (assignmentTarget.occupant) {
            newAssignments = newAssignments.filter(
                a => a.signupId !== assignmentTarget.occupant!.signupId
            );
            newPool.push({ ...assignmentTarget.occupant, slot: null, position: 0 });
        }

        // Assign new player
        newAssignments.push({
            ...sourceItem,
            slot: assignmentTarget.role,
            position: assignmentTarget.position,
            isOverride: sourceItem.character?.role !== assignmentTarget.role,
        });

        onRosterChange(newPool, newAssignments);
        toast.success(`${sourceItem.username} assigned to ${assignmentTarget.role} ${assignmentTarget.position}`);
        setAssignmentTarget(null);
    };

    // ROK-208: Remove player from slot back to pool
    const handleRemoveFromSlot = (signupId: number) => {
        const sourceItem = assignments.find(a => a.signupId === signupId);
        if (!sourceItem) return;

        const newAssignments = assignments.filter(a => a.signupId !== signupId);
        const newPool = [...pool, { ...sourceItem, slot: null, position: 0 }];

        onRosterChange(newPool, newAssignments);
        toast.success(`${sourceItem.username} moved to unassigned`);
        setAssignmentTarget(null);
    };

    // Close popup
    const handleClosePopup = () => {
        setAssignmentTarget(null);
        setBrowseAll(false);
    };

    const isPopupOpen = assignmentTarget !== null || browseAll;

    // ROK-208: Admin self-assign — check if current user is NOT already in the roster
    const isCurrentUserInRoster = currentUserId != null && (
        pool.some(p => p.userId === currentUserId) ||
        assignments.some(a => a.userId === currentUserId)
    );
    const canSelfAssign = canEdit && !isCurrentUserInRoster && currentUserId != null && onSlotClick;

    const handleSelfAssign = () => {
        if (!assignmentTarget || !onSlotClick) return;
        onSlotClick(assignmentTarget.role, assignmentTarget.position);
        setAssignmentTarget(null);
    };

    // ROK-208: Compute ALL slots for slot picker (empty + occupied with occupant info)
    const availableSlots = React.useMemo<AvailableSlot[]>(() => {
        const result: AvailableSlot[] = [];
        for (const { role, label, color } of roleSlots) {
            const count = getSlotCount(role);
            for (let i = 1; i <= count; i++) {
                const occupant = assignments.find(a => a.slot === role && a.position === i);
                result.push({
                    role,
                    position: i,
                    label,
                    color,
                    occupantName: occupant?.username,
                });
            }
        }
        return result;
    }, [roleSlots, assignments, getSlotCount]);

    // ROK-209: Check if all slots are filled
    const allSlotsFilled = React.useMemo(() =>
        roleSlots.every(({ role }) => {
            const count = getSlotCount(role);
            if (count === 0) return true;
            return assignments.filter(a => a.slot === role).length >= count;
        }),
        [roleSlots, assignments, getSlotCount]);

    // ROK-209: Auto-fill click — compute preview
    const handleAutoFillClick = () => {
        const result = computeAutoFill(pool, assignments, roleSlots, getSlotCount, isGenericGame);
        if (result.totalFilled === 0) {
            toast.info('No matching players to auto-fill');
            return;
        }
        setAutoFillPreview(result);
    };

    // ROK-209: Auto-fill confirm — apply changes
    const handleAutoFillConfirm = () => {
        if (!autoFillPreview) return;
        setIsBulkUpdating(true);
        try {
            onRosterChange(autoFillPreview.newPool, autoFillPreview.newAssignments);
            toast.success(`Auto-filled ${autoFillPreview.totalFilled} players`);
        } finally {
            setAutoFillPreview(null);
            setIsBulkUpdating(false);
        }
    };

    // ROK-209: Clear all — double-click pattern
    const handleClearAllClick = () => {
        if (clearPending) {
            // Second click — execute clear
            setClearPending(false);
            setIsBulkUpdating(true);
            try {
                const clearedPlayers = assignments.map(a => ({ ...a, slot: null, position: 0 }));
                const mergedPool = [...pool, ...clearedPlayers];
                onRosterChange(mergedPool, []);
                toast.success(`Roster cleared — ${assignments.length} players moved to pool`);
            } finally {
                setIsBulkUpdating(false);
            }
        } else {
            // First click — enter pending state
            setClearPending(true);
        }
    };

    // ROK-208: Assign player to a specific slot (from browse-all slot picker)
    const handleAssignToSlot = (signupId: number, role: RosterRole, position: number) => {
        const sourceItem = pool.find(p => p.signupId === signupId);
        if (!sourceItem) return;

        const newPool = pool.filter(p => p.signupId !== signupId);
        const newAssignments = [...assignments];

        newAssignments.push({
            ...sourceItem,
            slot: role,
            position,
            isOverride: sourceItem.character?.role !== role,
        });

        onRosterChange(newPool, newAssignments);
        toast.success(`${sourceItem.username} assigned to ${role} ${position}`);
        setBrowseAll(false);
    };

    return (
        <div className="space-y-4">
            {/* ROK-208: Unassigned Bar + optional sticky extra (e.g., GameTimeWidget) */}
            {stickyExtra ? (
                <div className="flex flex-col md:flex-row gap-2 items-stretch md:sticky md:top-28" style={{ zIndex: 20 }}>
                    <div className="flex-1 min-w-0">
                        <UnassignedBar
                            pool={pool}
                            onBarClick={() => setBrowseAll(true)}
                            inline
                        />
                    </div>
                    <div className="flex-1 min-w-0">
                        {stickyExtra}
                    </div>
                </div>
            ) : (
                <UnassignedBar
                    pool={pool}
                    onBarClick={() => setBrowseAll(true)}
                />
            )}

            {/* ROK-209: Auto-Fill & Clear All toolbar */}
            {canEdit && (
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm flex-1 md:flex-none"
                        disabled={pool.length === 0 || allSlotsFilled || isBulkUpdating}
                        onClick={handleAutoFillClick}
                    >
                        {isBulkUpdating ? (
                            <>
                                <svg className="inline-block mr-1 h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                </svg>
                                Updating…
                            </>
                        ) : (
                            'Auto-Fill'
                        )}
                    </button>
                    <button
                        type="button"
                        className={`btn btn-danger btn-sm flex-1 md:flex-none ${clearPending ? 'animate-pulse' : ''}`}
                        disabled={assignments.length === 0 || isBulkUpdating}
                        onClick={handleClearAllClick}
                    >
                        {clearPending ? 'Click again to clear' : 'Clear All'}
                    </button>
                </div>
            )}

            {/* ROK-209: Auto-Fill confirmation modal */}
            <Modal
                isOpen={autoFillPreview !== null}
                onClose={() => setAutoFillPreview(null)}
                title="Auto-Fill Roster"
            >
                {autoFillPreview && (
                    <div className="space-y-4">
                        <p className="text-sm text-secondary">
                            Auto-fill will assign <strong className="text-foreground">{autoFillPreview.totalFilled}</strong> players to roster slots:
                        </p>
                        <ul className="space-y-1 text-sm">
                            {autoFillPreview.summary.map(({ role, count }) => (
                                <li key={role} className="flex items-center gap-2">
                                    <span className="font-medium text-foreground">{count}</span>
                                    <span className="text-secondary">→ {role}</span>
                                </li>
                            ))}
                        </ul>
                        {autoFillPreview.newPool.length > 0 && (
                            <p className="text-xs text-dim">
                                {autoFillPreview.newPool.length} player{autoFillPreview.newPool.length !== 1 ? 's' : ''} will remain unassigned
                            </p>
                        )}
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setAutoFillPreview(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={handleAutoFillConfirm}
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Role Slots */}
            <div className="space-y-2 sm:space-y-4">
                {roleSlots.map(({ role, label, color }) => {
                    const count = getSlotCount(role);
                    const assigned = assignments.filter((a) => a.slot === role);
                    // Skip roles with 0 slots
                    if (count === 0) return null;

                    return (
                        <div key={role} className="rounded-lg border border-edge bg-surface/50 p-2 sm:p-4">
                            <h4 className="mb-2 sm:mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-secondary">
                                <span className={`inline-block h-3 w-3 rounded ${color}`} />
                                {/* ROK-183: For generic games show "Players" instead of just "Player" */}
                                {isGenericGame && role === 'player' ? 'Players' : label} ({assigned.length}/{count})
                            </h4>
                            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                                {Array.from({ length: count }, (_, i) => {
                                    const position = i + 1;
                                    const assignedItem = assigned.find((a) => a.position === position);

                                    return (
                                        <RosterSlot
                                            key={`slot-${role}-${position}`}
                                            role={role}
                                            position={position}
                                            item={assignedItem}
                                            color={color}
                                            onJoinClick={canJoin && !assignedItem ? onSlotClick : undefined}
                                            isCurrentUser={currentUserId != null && assignedItem?.userId === currentUserId}
                                            onAdminClick={canEdit ? handleAdminSlotClick : undefined}
                                            onRemove={canEdit ? handleRemoveFromSlot : undefined}
                                            onSelfRemove={!canEdit && onSelfRemove && currentUserId != null && assignedItem?.userId === currentUserId ? onSelfRemove : undefined}
                                            isPending={pendingSlotKey === `${role}-${position}`}
                                            onPendingChange={(pending) => setPendingSlotKey(pending ? `${role}-${position}` : null)}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ROK-208: Assignment Popup */}
            <AssignmentPopup
                isOpen={isPopupOpen}
                onClose={handleClosePopup}
                slotRole={assignmentTarget?.role ?? null}
                slotPosition={assignmentTarget?.position ?? 0}
                unassigned={pool}
                currentOccupant={assignmentTarget?.occupant}
                onAssign={handleAssign}
                onRemove={assignmentTarget?.occupant ? handleRemoveFromSlot : undefined}
                onSelfAssign={canSelfAssign ? handleSelfAssign : undefined}
                availableSlots={availableSlots}
                onAssignToSlot={handleAssignToSlot}
            />
        </div>
    );
}
