import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import React from 'react';
import { RosterCard } from './RosterCard';
import { FOCUS_RING } from '../ui/form-classes';

interface RosterSlotProps {
    role: RosterRole;
    position: number;
    item?: RosterAssignmentResponse;
    color: string;
    /** ROK-183: Called when user clicks empty slot to join */
    onJoinClick?: (role: RosterRole, position: number) => void;
    /** ROK-184: Whether this slot belongs to the current user (for glow effect) */
    isCurrentUser?: boolean;
    /** ROK-208: Called when admin clicks slot to open assignment popup */
    onAdminClick?: (role: RosterRole, position: number) => void;
    /** ROK-208: Admin can remove player from slot */
    onRemove?: (signupId: number) => void;
    /** ROK-226: Current user can self-unassign from their own slot */
    onSelfRemove?: () => void;
}

/**
 * RosterSlot - A slot for role-based roster positions (ROK-208).
 * Single click to join for regular users on empty slots.
 * Admin click opens assignment popup.
 * ROK-184: Glow effect for current user's slot
 */

function slotBorderClass(item: RosterAssignmentResponse | undefined, isCurrentUser: boolean, isClickable: boolean) {
    if (!item) return isClickable ? 'border-dashed border-edge-strong bg-panel/20 hover:border-indigo-400 hover:bg-indigo-500/10' : 'border-dashed border-edge bg-panel/20';
    // ROK-1237: mirror the EventDetailRoster.tsx departed treatment so the
    // assignment grid and the attendee list agree on visual state.
    if (item.signupStatus === 'departed') return 'border-dashed border-red-500/40 bg-red-900/10 opacity-60';
    if (item.signupStatus === 'tentative') return 'border-dashed border-amber-500/60 bg-amber-900/10';
    if (isCurrentUser) return 'border-emerald-400/50 bg-emerald-900/20';
    return 'border-edge bg-panel/80';
}

function EmptySlotContent({ isClickable, isAdmin }: { isClickable: boolean; isAdmin: boolean }) {
    return (
        <div className="flex h-full min-h-[60px] items-center justify-center">
            {isClickable ? (
                <span className="flex items-center gap-1 text-xs font-medium text-muted/70">
                    <span className="text-lg text-dim">+</span> <span>{isAdmin ? 'Assign' : 'Join'}</span>
                </span>
            ) : (
                <span className="text-lg text-dim/50">+</span>
            )}
        </div>
    );
}

function resolveRemoveFn(item: RosterAssignmentResponse, onRemove?: (id: number) => void, isCurrentUser?: boolean, onSelfRemove?: () => void) {
    if (onRemove) return () => onRemove(item.signupId);
    if (isCurrentUser && onSelfRemove) return onSelfRemove;
    return undefined;
}

/** Accessible name of the slot's action; keeps the visible "Join" / "Assign" word (WCAG 2.5.3). */
function slotActionLabel(role: RosterRole, position: number, item: RosterAssignmentResponse | undefined, isAdmin: boolean) {
    if (item) return `Manage ${role} slot ${position} (${item.username})`;
    return `${isAdmin ? 'Assign' : 'Join'} ${role} slot ${position}`;
}

export const RosterSlot = React.memo(function RosterSlot({ role, position, item, color, onJoinClick, isCurrentUser = false, onAdminClick, onRemove, onSelfRemove }: RosterSlotProps) {
    const handleClick = () => {
        if (!item && onJoinClick) { onJoinClick(role, position); return; }
        if (onAdminClick) onAdminClick(role, position);
    };

    const isClickable = !!onAdminClick || (!item && !!onJoinClick);
    const isTentative = item?.signupStatus === 'tentative';
    const isDeparted = item?.signupStatus === 'departed';
    const glowClass = isCurrentUser && !isDeparted ? 'ring-2 ring-emerald-400/60 shadow-[0_0_15px_rgba(52,211,153,0.4)] animate-pulse-subtle' : '';
    const badgeBg = isDeparted ? 'bg-red-600' : isTentative ? 'bg-amber-600' : color;
    const badgeContent = isDeparted ? `\u{1F6AA} ${position}` : isTentative ? `\u23F3 ${position}` : position;

    return (
        <div className={`relative min-h-[60px] rounded-lg border transition-all ${isClickable ? 'cursor-pointer' : ''} ${glowClass} ${slotBorderClass(item, isCurrentUser, isClickable)}`}>
            {/* TDB:1949 — a stretched native button BESIDE the card, never around its name link / Remove button (axe nested-interactive). */}
            {isClickable && (
                <button type="button" onClick={handleClick} aria-label={slotActionLabel(role, position, item, !!onAdminClick)}
                    className={`absolute inset-0 cursor-pointer rounded-lg ${FOCUS_RING}`} />
            )}
            <span className={`absolute -top-2 left-2 z-10 rounded px-1.5 text-xs font-semibold ${badgeBg} text-foreground`}>
                {badgeContent}
            </span>
            {item ? (
                // raiseControls lifts the card's link, Remove button and titled badges above the stretched slot button.
                <div className="p-1"><RosterCard item={item} onRemove={resolveRemoveFn(item, onRemove, isCurrentUser, onSelfRemove)} raiseControls={isClickable} /></div>
            ) : (
                <EmptySlotContent isClickable={isClickable} isAdmin={!!onAdminClick} />
            )}
        </div>
    );
});
