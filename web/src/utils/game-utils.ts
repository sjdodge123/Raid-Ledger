/**
 * Game utility functions
 * 
 * Shared logic for detecting game types and calculating durations.
 */

/** Slot configuration type for roster */
interface SlotConfig {
    tank?: number;
    healer?: number;
    dps?: number;
    flex?: number;
    player?: number;
    bench?: number;
}

/**
 * Check if a slot configuration is for an MMO game (has tank/healer/dps roles)
 * Fix #7: Extracted from duplicate logic in CalendarView and event-detail-page
 */
export function isMMOSlotConfig(slots?: SlotConfig | null): boolean {
    if (!slots) return false;
    return Boolean(slots.tank || slots.healer || slots.dps);
}

/**
 * Format a duration between two dates as a human-readable string.
 * Fix #9: Extracted from duplicate logic in EventBanner and CalendarView
 * 
 * @example formatDuration(start, end) => "3h 30m" or "45m" or "2h"
 */
export function formatDuration(startDate: Date, endDate: Date): string {
    const diffMs = endDate.getTime() - startDate.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

/**
 * Get duration in minutes between two dates.
 */
export function getDurationMinutes(startDate: Date, endDate: Date): number {
    return Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60));
}
