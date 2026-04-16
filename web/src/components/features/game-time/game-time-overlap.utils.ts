/**
 * Returns true if any hour covered by the event matches an "available" slot
 * in the user's weekly game-time template.
 *
 * Slots use the Sunday-first convention (0=Sun .. 6=Sat) — the same convention
 * as JS `Date.getDay()`. The server normalizes the DB's Monday-first storage
 * to Sunday-first before sending to the client (see
 * `api/src/users/game-time.service.ts`), so no day conversion is needed here.
 *
 * The cursor is floored to the event's start hour and advances one hour at a
 * time until the event end; any hour that lands on an available slot counts
 * as an overlap. A slot counts as "available" when `status === 'available'`
 * or `status` is absent.
 *
 * @param slots - User's weekly game-time template slots (Sunday-first)
 * @param startTime - Event start as ISO string
 * @param endTime - Event end as ISO string
 * @returns true when the event intersects at least one available slot
 */
export function checkGameTimeOverlap(
    slots: Array<{ dayOfWeek: number; hour: number; status?: string }>,
    startTime: string,
    endTime: string,
): boolean {
    if (!slots.length) return false;
    const templateSet = new Set(
        slots
            .filter((s) => s.status === 'available' || !s.status)
            .map((s) => `${s.dayOfWeek}:${s.hour}`),
    );
    const start = new Date(startTime);
    const end = new Date(endTime);
    const cursor = new Date(start);
    cursor.setMinutes(0, 0, 0);
    if (cursor < start) cursor.setHours(cursor.getHours() + 1);
    while (cursor < end) {
        if (templateSet.has(`${cursor.getDay()}:${cursor.getHours()}`)) return true;
        cursor.setHours(cursor.getHours() + 1);
    }
    return false;
}
