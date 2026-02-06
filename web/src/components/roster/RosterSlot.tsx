import { useState, useEffect } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { RosterCard } from './RosterCard';

interface RosterSlotProps {
    id: string;
    role: RosterRole;
    position: number;
    item?: RosterAssignmentResponse;
    color: string;
    isDraggable: boolean;
    /** ROK-183: Called when user double-clicks empty slot to join */
    onJoinClick?: (role: RosterRole, position: number) => void;
}

/**
 * RosterSlot - A droppable slot for role-based roster positions (ROK-114, ROK-183).
 * Supports double-click to join for regular users on empty slots.
 * First click: shows "Join?" confirmation state
 * Second click: triggers the join action
 */
export function RosterSlot({ id, role, position, item, color, isDraggable, onJoinClick }: RosterSlotProps) {
    const { isOver, setNodeRef } = useDroppable({
        id,
        data: { role, position },
    });

    // ROK-183: Double-click confirmation state
    const [isPending, setIsPending] = useState(false);

    // Auto-reset pending state after 3 seconds
    useEffect(() => {
        if (isPending) {
            const timeout = setTimeout(() => setIsPending(false), 3000);
            return () => clearTimeout(timeout);
        }
    }, [isPending]);

    const handleClick = () => {
        if (!item && onJoinClick) {
            if (isPending) {
                // Second click - confirm the join
                onJoinClick(role, position);
                setIsPending(false);
            } else {
                // First click - show confirmation state
                setIsPending(true);
            }
        }
    };

    const isClickable = !item && !!onJoinClick;

    return (
        <div
            ref={setNodeRef}
            onClick={handleClick}
            className={`
        relative min-h-[60px] rounded-lg border-2 border-dashed transition-all
        ${isClickable ? 'cursor-pointer' : ''}
        ${isPending
                    ? 'border-green-500 bg-green-500/20'
                    : isOver
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : item
                            ? 'border-transparent bg-slate-800/50'
                            : isClickable
                                ? 'border-slate-600 bg-slate-800/30 hover:border-indigo-400 hover:bg-indigo-500/10'
                                : 'border-slate-600 bg-slate-800/30'
                }
      `}
        >
            {/* Position label */}
            <span
                className={`
          absolute -top-2 left-2 z-10 rounded px-1.5 text-xs font-semibold
          ${isPending ? 'bg-green-600' : color} text-white
        `}
            >
                {position}
            </span>

            {/* Slot content */}
            {item ? (
                <div className="p-1">
                    <RosterCard
                        id={`assignment-${item.signupId}`}
                        item={item}
                        isDraggable={isDraggable}
                    />
                </div>
            ) : (
                <div className="flex h-full min-h-[60px] items-center justify-center">
                    {isPending ? (
                        <span className="flex items-center gap-1 text-sm font-medium text-green-400 animate-pulse">
                            Join?
                        </span>
                    ) : isClickable ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-indigo-400">
                            <span className="text-lg">+</span> Join
                        </span>
                    ) : (
                        <span className="text-xs text-slate-500">
                            Drop {role} here
                        </span>
                    )}
                </div>
            )}

            {/* Override warning */}
            {item?.isOverride && (
                <div className="absolute -bottom-1 -right-1 rounded-full bg-yellow-500 p-0.5">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="h-3 w-3 text-slate-900"
                    >
                        <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575L6.457 1.047Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368L8.22 1.754ZM7.25 11a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Zm.75-5.5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 .75-.75Z" />
                    </svg>
                </div>
            )}
        </div>
    );
}
