import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import React, { useRef, useEffect } from 'react';
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
    /** ROK-226: Current user can self-unassign from their own slot */
    onSelfRemove?: () => void;
    /** Whether this slot is in the "Join?" confirmation state (controlled by parent) */
    isPending?: boolean;
    /** Called to toggle the pending confirmation state */
    onPendingChange?: (pending: boolean) => void;
}

/**
 * RosterSlot - A slot for role-based roster positions (ROK-208).
 * Supports double-click to join for regular users on empty slots.
 * Admin click opens assignment popup.
 * First click: shows "Join?" confirmation state
 * Second click: triggers the join action
 * ROK-184: Glow effect for current user's slot
 *
 * The "pending" (Join?) state is controlled by the parent to survive
 * background React Query refetches that would otherwise remount this component.
 */
export const RosterSlot = React.memo(function RosterSlot({ role, position, item, color, onJoinClick, isCurrentUser = false, onAdminClick, onRemove, onSelfRemove, isPending = false, onPendingChange }: RosterSlotProps) {
    // Capture the onJoinClick callback so that a React Query refetch
    // that briefly sets onJoinClick=undefined doesn't prevent the
    // confirmation click from firing.
    const savedJoinClickRef = useRef(onJoinClick);

    // ROK-467: Keep the ref in sync when the prop is defined;
    // clear it when both onJoinClick and isPending are gone
    // (i.e., parent genuinely revoked join ability, not just a brief refetch blip).
    useEffect(() => {
        if (onJoinClick) {
            savedJoinClickRef.current = onJoinClick;
        } else if (!isPending) {
            savedJoinClickRef.current = undefined;
        }
    }, [onJoinClick, isPending]);

    const handleClick = () => {
        // ROK-466: Join click takes priority over admin click for empty slots.
        // This prevents a stale onAdminClick from intercepting a legitimate join.
        // Regular user: double-click join on empty slots
        const joinFn = onJoinClick ?? (isPending ? savedJoinClickRef.current : undefined);
        if (!item && joinFn) {
            if (isPending) {
                // Second click - confirm the join
                joinFn(role, position);
                onPendingChange?.(false);
            } else {
                // First click - show confirmation state
                savedJoinClickRef.current = joinFn;
                onPendingChange?.(true);
            }
            return;
        }
        // Admin click: open assignment popup (only if no join flow is active)
        if (onAdminClick) {
            onAdminClick(role, position);
        }
    };

    const isOccupied = !!item;
    const isClickable = onAdminClick || (!isOccupied && !!(onJoinClick || isPending));
    const isTentative = item?.signupStatus === 'tentative';

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
                        ? isTentative
                            ? 'border-dashed border-amber-500/60 bg-amber-900/10'
                            : isCurrentUser
                                ? 'border-emerald-400/50 bg-emerald-900/20'
                                : 'border-edge bg-panel/80'
                        : isClickable
                            ? 'border-dashed border-edge-strong bg-panel/20 hover:border-indigo-400 hover:bg-indigo-500/10'
                            : 'border-dashed border-edge bg-panel/20'
                }
      `}
        >
            {/* Position label */}
            <span
                className={`
          absolute -top-2 left-2 z-10 rounded px-1.5 text-xs font-semibold
          ${isPending ? 'bg-green-600' : isTentative ? 'bg-amber-600' : color} text-foreground
        `}
            >
                {isTentative ? `⏳ ${position}` : position}
            </span>

            {/* Slot content */}
            {item ? (
                <div className="p-1">
                    <RosterCard
                        item={item}
                        onRemove={
                            onRemove ? () => onRemove(item.signupId)
                                : (isCurrentUser && onSelfRemove) ? onSelfRemove
                                    : undefined
                        }
                    />
                </div>
            ) : (
                <div className="flex h-full min-h-[60px] items-center justify-center">
                    {isPending ? (
                        <span className="flex items-center gap-1 text-sm font-medium text-green-400 animate-pulse">
                            Join?
                        </span>
                    ) : isClickable ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-muted/70">
                            {onAdminClick ? (
                                <><span className="text-lg text-dim">+</span> <span>Assign</span></>
                            ) : (
                                <><span className="text-lg text-dim">+</span> <span>Join</span></>
                            )}
                        </span>
                    ) : (
                        <span className="text-lg text-dim/50">
                            +
                        </span>
                    )}
                </div>
            )}
        </div>
    );
});
