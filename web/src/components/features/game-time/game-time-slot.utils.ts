import type { GameTimeSlot } from '@raid-ledger/contract';

export const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Returns true if a slot counts as "available" (explicit or implicit) */
export function isSlotActive(s: GameTimeSlot): boolean {
    return s.status === 'available' || !s.status;
}

/**
 * Toggle hours for a given day within the visible range.
 * If all visible hours are active, deselects them.
 * Otherwise, fills in missing visible hours as available.
 * Does not modify committed or blocked slots.
 */
export function toggleAllDaySlots(
    slots: GameTimeSlot[],
    dayIndex: number,
    hourRange?: [number, number],
): GameTimeSlot[] {
    const hours = hourRange ? ALL_HOURS.filter((h) => h >= hourRange[0] && h < hourRange[1]) : ALL_HOURS;
    const dayActiveHours = new Set(
        slots.filter((s) => s.dayOfWeek === dayIndex && isSlotActive(s)).map((s) => s.hour),
    );
    const allActive = hours.every((h) => dayActiveHours.has(h));

    if (allActive) {
        return slots.filter(
            (s) => !(s.dayOfWeek === dayIndex && hours.includes(s.hour) && isSlotActive(s)),
        );
    }

    const existingHours = new Set(
        slots.filter((s) => s.dayOfWeek === dayIndex).map((s) => s.hour),
    );
    const toAdd = hours
        .filter((h) => !existingHours.has(h))
        .map((h) => ({ dayOfWeek: dayIndex, hour: h, status: 'available' as const }));

    return [...slots, ...toAdd];
}

/**
 * Check if all hours in the visible range are active (available) for a given day.
 */
export function isAllDayActive(
    slots: GameTimeSlot[],
    dayIndex: number,
    hourRange?: [number, number],
): boolean {
    const hours = hourRange ? ALL_HOURS.filter((h) => h >= hourRange[0] && h < hourRange[1]) : ALL_HOURS;
    const dayActiveHours = new Set(
        slots.filter((s) => s.dayOfWeek === dayIndex && isSlotActive(s)).map((s) => s.hour),
    );
    return hours.every((h) => dayActiveHours.has(h));
}
