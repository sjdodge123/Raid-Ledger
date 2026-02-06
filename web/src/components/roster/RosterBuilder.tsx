import React from 'react';
import {
    DndContext,
    DragOverlay,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { RosterCard } from './RosterCard';
import { RosterSlot } from './RosterSlot';

interface RosterBuilderProps {
    /** Unassigned users (signup pool) */
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
 * RosterBuilder - Drag-and-drop roster assignment component (ROK-114, ROK-183).
 * Supports MMO-style role slots and generic player slots.
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
}: RosterBuilderProps) {
    const [activeId, setActiveId] = React.useState<string | null>(null);

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

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    );

    // Find the actively dragged item
    const activeItem = React.useMemo(() => {
        if (!activeId) return null;
        const poolItem = pool.find((p) => `pool-${p.signupId}` === activeId);
        if (poolItem) return poolItem;
        return assignments.find((a) => `assignment-${a.signupId}` === activeId) ?? null;
    }, [activeId, pool, assignments]);

    function handleDragStart(event: DragStartEvent) {
        if (!canEdit) return;
        setActiveId(event.active.id as string);
    }

    function handleDragEnd(event: DragEndEvent) {
        setActiveId(null);
        if (!canEdit) return;

        const { active, over } = event;
        if (!over) return;

        const activeIdStr = active.id as string;
        const overIdStr = over.id as string;

        // Determine source (pool or assignment)
        const isFromPool = activeIdStr.startsWith('pool-');
        const sourceSignupId = parseInt(activeIdStr.split('-')[1], 10);

        // Determine target
        const isToSlot = overIdStr.startsWith('slot-');
        const isToPool = overIdStr === 'pool-zone' || overIdStr.startsWith('pool-');

        if (isToSlot) {
            // Dropping onto a role slot
            const [, role, positionStr] = overIdStr.split('-');
            const position = parseInt(positionStr, 10);

            const sourceItem = isFromPool
                ? pool.find((p) => p.signupId === sourceSignupId)
                : assignments.find((a) => a.signupId === sourceSignupId);

            if (!sourceItem) return;

            // Check if slot is already occupied
            const existingInSlot = assignments.find(
                (a) => a.slot === role && a.position === position,
            );

            let newPool = [...pool];
            let newAssignments = [...assignments];

            // Remove from source
            if (isFromPool) {
                newPool = newPool.filter((p) => p.signupId !== sourceSignupId);
            } else {
                newAssignments = newAssignments.filter((a) => a.signupId !== sourceSignupId);
            }

            // If slot occupied, move existing to pool
            if (existingInSlot) {
                newAssignments = newAssignments.filter(
                    (a) => a.signupId !== existingInSlot.signupId,
                );
                newPool.push({ ...existingInSlot, slot: null, position: 0 });
            }

            // Add to new slot
            newAssignments.push({
                ...sourceItem,
                slot: role as RosterRole,
                position,
                isOverride: sourceItem.character?.role !== role,
            });

            onRosterChange(newPool, newAssignments);
        } else if (isToPool && !isFromPool) {
            // Moving from assignment back to pool
            const sourceItem = assignments.find((a) => a.signupId === sourceSignupId);
            if (!sourceItem) return;

            const newAssignments = assignments.filter((a) => a.signupId !== sourceSignupId);
            const newPool = [...pool, { ...sourceItem, slot: null, position: 0 }];

            onRosterChange(newPool, newAssignments);
        }
    }

    // Get slot counts (use default or custom)
    const getSlotCount = (role: RosterRole): number => {
        if (slots?.[role] !== undefined) return slots[role]!;
        return roleSlots.find((s) => s.role === role)?.count ?? 0;
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <div className="grid gap-6 lg:grid-cols-2">
                {/* Signup Pool */}
                <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
                    <h3 className="mb-4 text-lg font-semibold text-slate-200">
                        Signup Pool ({pool.length})
                    </h3>
                    <SortableContext
                        items={pool.map((p) => `pool-${p.signupId}`)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div
                            id="pool-zone"
                            className="min-h-[200px] space-y-2 rounded-lg border-2 border-dashed border-slate-600 p-2"
                        >
                            {pool.length === 0 ? (
                                <p className="py-8 text-center text-sm text-slate-500">
                                    All users assigned to roster
                                </p>
                            ) : (
                                pool.map((item) => (
                                    <RosterCard
                                        key={`pool-${item.signupId}`}
                                        id={`pool-${item.signupId}`}
                                        item={item}
                                        isDraggable={canEdit}
                                    />
                                ))
                            )}
                        </div>
                    </SortableContext>
                </div>

                {/* Role Slots */}
                <div className="space-y-4">
                    {roleSlots.map(({ role, label, color }) => {
                        const count = getSlotCount(role);
                        const assigned = assignments.filter((a) => a.slot === role);
                        // Skip roles with 0 slots
                        if (count === 0) return null;

                        return (
                            <div key={role} className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
                                <h4 className={`mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300`}>
                                    <span className={`inline-block h-3 w-3 rounded ${color}`} />
                                    {/* ROK-183: For generic games show "Player 1" instead of just "Player" */}
                                    {isGenericGame && role === 'player' ? 'Players' : label} ({assigned.length}/{count})
                                </h4>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-3">
                                    {Array.from({ length: count }, (_, i) => {
                                        const position = i + 1;
                                        const assignedItem = assigned.find((a) => a.position === position);

                                        return (
                                            <RosterSlot
                                                key={`slot-${role}-${position}`}
                                                id={`slot-${role}-${position}`}
                                                role={role}
                                                position={position}
                                                item={assignedItem}
                                                color={color}
                                                isDraggable={canEdit}
                                                onJoinClick={canJoin && !assignedItem ? onSlotClick : undefined}
                                                isCurrentUser={assignedItem?.userId === currentUserId}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Drag Overlay */}
            <DragOverlay>
                {activeItem ? (
                    <RosterCard
                        id={`overlay-${activeItem.signupId}`}
                        item={activeItem}
                        isDraggable={false}
                        isOverlay
                    />
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}
