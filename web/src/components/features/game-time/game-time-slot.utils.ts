import type { GameTimeSlot } from '@raid-ledger/contract';

export const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Returns true if a slot counts as "available" (explicit or implicit) */
export function isSlotActive(s: GameTimeSlot): boolean {
    return s.status === 'available' || !s.status;
}

/** Hours that are blocked/committed and can't be toggled */
function getLockedHours(slots: GameTimeSlot[], dayIndex: number): Set<number> {
    return new Set(slots.filter((s) => s.dayOfWeek === dayIndex && s.status && !isSlotActive(s)).map((s) => s.hour));
}

/** Compute visible hours from a range, supporting wrapping (e.g. [9, 2] = 9..23, 0..1) */
function visibleHours(hourRange?: [number, number]): number[] {
    if (!hourRange) return ALL_HOURS;
    const [start, end] = hourRange;
    if (start < end) return ALL_HOURS.filter((h) => h >= start && h < end);
    return [...ALL_HOURS.filter((h) => h >= start), ...ALL_HOURS.filter((h) => h < end)];
}

/** Visible hours minus locked (blocked/committed) ones */
function getToggleableHours(slots: GameTimeSlot[], dayIndex: number, hourRange?: [number, number]): number[] {
    const locked = getLockedHours(slots, dayIndex);
    return visibleHours(hourRange).filter((h) => !locked.has(h));
}

/**
 * Toggle hours for a given day within the visible range.
 * If all toggleable hours are active, deselects them.
 * Otherwise, fills in missing toggleable hours as available.
 * Blocked/committed slots are never modified.
 */
export function toggleAllDaySlots(
    slots: GameTimeSlot[],
    dayIndex: number,
    hourRange?: [number, number],
): GameTimeSlot[] {
    const toggleable = getToggleableHours(slots, dayIndex, hourRange);
    if (toggleable.length === 0) return slots;

    const dayActiveHours = new Set(
        slots.filter((s) => s.dayOfWeek === dayIndex && isSlotActive(s)).map((s) => s.hour),
    );
    const allActive = toggleable.every((h) => dayActiveHours.has(h));

    if (allActive) {
        const visibleSet = new Set(visibleHours(hourRange));
        return slots.filter(
            (s) => !(s.dayOfWeek === dayIndex && visibleSet.has(s.hour) && isSlotActive(s)),
        );
    }

    const existingHours = new Set(
        slots.filter((s) => s.dayOfWeek === dayIndex).map((s) => s.hour),
    );
    const toAdd = toggleable
        .filter((h) => !existingHours.has(h))
        .map((h) => ({ dayOfWeek: dayIndex, hour: h, status: 'available' as const }));

    return [...slots, ...toAdd];
}

/**
 * Check if all toggleable hours in the visible range are active for a given day.
 * Blocked/committed hours are excluded from the check.
 */
export function isAllDayActive(
    slots: GameTimeSlot[],
    dayIndex: number,
    hourRange?: [number, number],
): boolean {
    const toggleable = getToggleableHours(slots, dayIndex, hourRange);
    if (toggleable.length === 0) return false;
    const dayActiveHours = new Set(
        slots.filter((s) => s.dayOfWeek === dayIndex && isSlotActive(s)).map((s) => s.hour),
    );
    return toggleable.every((h) => dayActiveHours.has(h));
}
