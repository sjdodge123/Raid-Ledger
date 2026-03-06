import type { EventResponseDto, GameTimeSlot } from '@raid-ledger/contract';

/**
 * Convert JS Date.getDay() (0=Sunday) to game-time dayOfWeek (0=Monday).
 */
export function toGameTimeDow(jsDay: number): number {
    return jsDay === 0 ? 6 : jsDay - 1;
}

/**
 * Check if an event overlaps with any game time slot.
 * Checks every hour the event spans, not just the start hour.
 */
export function eventOverlapsGameTime(
    event: EventResponseDto,
    slotSet: Set<string>,
): boolean {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    const cursor = new Date(start);
    cursor.setMinutes(0, 0, 0);
    if (cursor < start) cursor.setHours(cursor.getHours() + 1);

    while (cursor < end) {
        const key = `${toGameTimeDow(cursor.getDay())}-${cursor.getHours()}`;
        if (slotSet.has(key)) return true;
        cursor.setHours(cursor.getHours() + 1);
    }
    return false;
}
