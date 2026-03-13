import type { GameTimeSlot } from '@raid-ledger/contract';

export const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Returns true if a slot counts as "available" (explicit or implicit) */
export function isSlotActive(s: GameTimeSlot): boolean {
    return s.status === 'available' || !s.status;
}

/**
 * Toggle all 24 hours for a given day.
 * If all available-status hours are present, deselects them.
 * Otherwise, fills in missing hours as available.
 * Does not modify committed or blocked slots.
 */
export function toggleAllDaySlots(
    slots: GameTimeSlot[],
    dayIndex: number,
): GameTimeSlot[] {
    const dayActiveHours = new Set(
        slots.filter((s) => s.dayOfWeek === dayIndex && isSlotActive(s)).map((s) => s.hour),
    );
    const allActive = ALL_HOURS.every((h) => dayActiveHours.has(h));

    if (allActive) {
        return slots.filter(
            (s) => !(s.dayOfWeek === dayIndex && isSlotActive(s)),
        );
    }

    const existingHours = new Set(
        slots.filter((s) => s.dayOfWeek === dayIndex).map((s) => s.hour),
    );
    const toAdd = ALL_HOURS
        .filter((h) => !existingHours.has(h))
        .map((h) => ({ dayOfWeek: dayIndex, hour: h, status: 'available' as const }));

    return [...slots, ...toAdd];
}

/**
 * Check if all 24 hours are active (available) for a given day.
 */
export function isAllDayActive(
    slots: GameTimeSlot[],
    dayIndex: number,
): boolean {
    const dayActiveHours = new Set(
        slots.filter((s) => s.dayOfWeek === dayIndex && isSlotActive(s)).map((s) => s.hour),
    );
    return ALL_HOURS.every((h) => dayActiveHours.has(h));
}
