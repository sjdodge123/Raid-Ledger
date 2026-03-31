import React, { useState } from 'react';
import type { RosterAvailabilityResponse, AvailabilityStatus } from '@raid-ledger/contract';
import { AvailabilityCell } from './AvailabilityCell';
import { HeatmapTooltip } from './HeatmapTooltip';
import { resolveAvatar, toAvatarUser } from '../../../lib/avatar';

interface HeatmapGridProps {
    data: RosterAvailabilityResponse;
    slotDurationMinutes?: number;
}

interface TimeSlot {
    start: Date;
    end: Date;
    label: string;
}

interface TooltipInfo {
    user: { id: number; username: string; avatar: string | null };
    status: AvailabilityStatus | 'none';
    timeRange: { start: string; end: string };
}

/**
 * Generate time slots for the heatmap grid.
 * Uses 15-minute increments starting from the hour for finer granularity.
 * Only generates labels for the :00 marks.
 */
function generateTimeSlots(startTime: string, endTime: string, durationMinutes: number): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const start = new Date(startTime);
    const end = new Date(endTime);

    // Snap to beginning of the hour for clean grid alignment
    const snappedStart = new Date(start);
    snappedStart.setMinutes(0, 0, 0);

    let current = new Date(snappedStart);
    while (current < end) {
        const slotEnd = new Date(current.getTime() + durationMinutes * 60 * 1000);
        // Only show label on the hour (when minutes === 0)
        const showLabel = current.getMinutes() === 0;
        slots.push({
            start: new Date(current),
            end: slotEnd > end ? end : slotEnd,
            label: showLabel
                ? current.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                : '',
        });
        current = slotEnd;
    }

    return slots;
}

/**
 * Determine availability status for a specific time slot.
 */
function getSlotStatus(
    slots: Array<{ start: string; end: string; status: AvailabilityStatus }>,
    slotStart: Date,
    slotEnd: Date
): AvailabilityStatus | 'none' {
    for (const availability of slots) {
        const availStart = new Date(availability.start);
        const availEnd = new Date(availability.end);

        // Check if there's any overlap
        if (slotStart < availEnd && slotEnd > availStart) {
            return availability.status;
        }
    }
    return 'none';
}

/**
 * Heatmap grid showing team availability (ROK-113).
 * Displays time slots (rows) x users (columns) with color-coded cells.
 * ROK-222: Uses resolveAvatar() for user avatars.
 */
function UserAvatarHeader({ user }: { user: { id: number; username: string; avatar: string | null } }) {
    const userAvatar = resolveAvatar(toAvatarUser(user));
    return (
        <div className="flex flex-col items-center justify-center h-10" title={user.username} data-testid="heatmap-day-label">
            {userAvatar.url ? (
                <img src={userAvatar.url} alt={user.username} className="w-6 h-6 rounded-full" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : (
                <div className="w-6 h-6 rounded-full bg-overlay flex items-center justify-center text-[9px] font-semibold text-muted">{user.username.charAt(0).toUpperCase()}</div>
            )}
            <span className="text-xs text-muted truncate max-w-full">{user.username.slice(0, 6)}</span>
        </div>
    );
}

function SlotRow({ slot, slotIndex, users, onHover, onLeave }: {
    slot: TimeSlot; slotIndex: number; users: HeatmapGridProps['data']['users'];
    onHover: (e: React.MouseEvent, user: typeof users[0], slot: TimeSlot, status: AvailabilityStatus | 'none') => void;
    onLeave: () => void;
}) {
    return (
        <React.Fragment key={`row-${slotIndex}`}>
            <div className="flex items-center justify-end pr-2 text-xs text-muted" {...(slot.label ? { 'data-testid': 'heatmap-time-label' } : {})}>{slot.label}</div>
            {users.map((user) => {
                const status = getSlotStatus(user.slots, slot.start, slot.end);
                return (
                    <div key={`${user.id}-${slotIndex}`} onMouseEnter={(e) => onHover(e, user, slot, status)} onMouseLeave={onLeave} role="gridcell" aria-label={`${user.username}: ${status} at ${slot.label}`}>
                        <AvailabilityCell status={status} />
                    </div>
                );
            })}
        </React.Fragment>
    );
}

export function HeatmapGrid({ data, slotDurationMinutes = 30 }: HeatmapGridProps) {
    const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    const timeSlots = generateTimeSlots(data.timeRange.start, data.timeRange.end, slotDurationMinutes);

    if (data.users.length === 0) {
        return <div className="text-center py-8 text-muted"><p className="text-sm">No signed-up users to display.</p></div>;
    }

    const handleCellHover = (event: React.MouseEvent, user: typeof data.users[0], slot: TimeSlot, status: AvailabilityStatus | 'none') => {
        setTooltip({ user: { id: user.id, username: user.username, avatar: user.avatar }, status, timeRange: { start: slot.start.toISOString(), end: slot.end.toISOString() } });
        setTooltipPosition({ x: event.clientX, y: event.clientY });
    };

    return (
        <div className="relative overflow-x-auto">
            <div className="grid gap-1" style={{ gridTemplateColumns: `80px repeat(${data.users.length}, minmax(40px, 1fr))` }}>
                <div className="h-10" />
                {data.users.map((user) => <UserAvatarHeader key={user.id} user={user} />)}
                {timeSlots.map((slot, i) => <SlotRow key={i} slot={slot} slotIndex={i} users={data.users} onHover={handleCellHover} onLeave={() => setTooltip(null)} />)}
            </div>
            {tooltip && <HeatmapTooltip username={tooltip.user.username} status={tooltip.status} timeRange={tooltip.timeRange} position={tooltipPosition} />}
        </div>
    );
}
