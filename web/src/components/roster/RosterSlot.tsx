import { useState, useEffect } from 'react';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { RosterCard } from './RosterCard';

interface RosterSlotProps {
    role: RosterRole;
    position: number;
    item?: RosterAssignmentResponse;
    color: string;
    /** ROK-183: Called when user double-clicks empty slot to join */
    onJoinClick?: (role: RosterRole, position: number) => void;
    /** ROK-184: Whether this slot belongs to the current user (for glow effect) */
    isCurrentUser?: boolean;
    /** ROK-208: Called when admin clicks slot to open assignment popup */
    onAdminClick?: (role: RosterRole, position: number) => void;
    /** ROK-208: Admin can remove player from slot */
    onRemove?: (signupId: number) => void;
}

/**
 * RosterSlot - A slot for role-based roster positions (ROK-208).
 * Supports double-click to join for regular users on empty slots.
 * Admin click opens assignment popup.
 * First click: shows "Join?" confirmation state
 * Second click: triggers the join action
 * ROK-184: Glow effect for current user's slot
 */
export function RosterSlot({ role, position, item, color, onJoinClick, isCurrentUser = false, onAdminClick, onRemove }: RosterSlotProps) {
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
        // Admin click: open assignment popup
        if (onAdminClick) {
            onAdminClick(role, position);
            return;
        }
        // Regular user: double-click join on empty slots
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

    const isClickable = onAdminClick || (!item && !!onJoinClick);

    // ROK-184: Glow effect classes for current user's slot
    const glowClass = isCurrentUser
        ? 'ring-2 ring-emerald-400/60 shadow-[0_0_15px_rgba(52,211,153,0.4)] animate-pulse-subtle'
        : '';

    return (
        <div
            onClick={handleClick}
            className={`
        relative min-h-[60px] rounded-lg border transition-all
        ${isClickable ? 'cursor-pointer' : ''}
        ${glowClass}
        ${isPending
                    ? 'border-green-500 bg-green-500/20'
                    : item
                        ? isCurrentUser
                            ? 'border-emerald-400/50 bg-emerald-900/20'
                            : 'border-slate-700 bg-slate-800/50'
                        : isClickable
                            ? 'border-slate-600 bg-slate-800/30 hover:border-indigo-400 hover:bg-indigo-500/10'
                            : 'border-slate-700 bg-slate-800/30'
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
                        item={item}
                        onRemove={onRemove ? () => onRemove(item.signupId) : undefined}
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
                            {onAdminClick ? (
                                <><span>Assign</span> <span className="text-lg">+</span></>
                            ) : (
                                <><span className="text-lg">+</span> Join</>
                            )}
                        </span>
                    ) : (
                        <span className="text-xs text-slate-500">
                            Empty
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
