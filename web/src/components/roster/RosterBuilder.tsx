import React from 'react';
import { toast } from 'sonner';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { RosterSlot } from './RosterSlot';
import { UnassignedBar } from './UnassignedBar';
import { AssignmentPopup } from './AssignmentPopup';
import type { AvailableSlot } from './AssignmentPopup';

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
    { role: 'bench', count: 0, label: 'Bench', color: 'bg-slate-600' };

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
                <div className="flex gap-2 items-stretch" style={{ position: 'sticky', top: '7rem', zIndex: 20 }}>
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

            {/* Role Slots */}
            <div className="space-y-4">
                {roleSlots.map(({ role, label, color }) => {
                    const count = getSlotCount(role);
                    const assigned = assignments.filter((a) => a.slot === role);
                    // Skip roles with 0 slots
                    if (count === 0) return null;

                    return (
                        <div key={role} className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
                            <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
                                <span className={`inline-block h-3 w-3 rounded ${color}`} />
                                {/* ROK-183: For generic games show "Players" instead of just "Player" */}
                                {isGenericGame && role === 'player' ? 'Players' : label} ({assigned.length}/{count})
                            </h4>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-3">
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
