import type { GameTimeSlot } from '@raid-ledger/contract';

/**
 * Walks the event [startTime, endTime) range hour-by-hour, invoking `visit`
 * with the local `dayOfWeek` (0=Sun..6=Sat) and `hour` at each step.
 *
 * The cursor floors to the start hour and only advances when it sits strictly
 * before the start (sub-hour starts skip the partial hour). Using
 * `setHours(getHours() + 1)` makes the walk DST-aware: on spring-forward the
 * skipped wall-clock hour is never visited; on fall-back the repeated hour is
 * visited once per wall-clock occurrence.
 *
 * @param startTime - Event start as ISO string
 * @param endTime - Event end as ISO string
 * @param visit - Invoked per covered hour with `(dayOfWeek, hour)`
 */
export function walkEventHours(
    startTime: string,
    endTime: string,
    visit: (dayOfWeek: number, hour: number) => void,
): void {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const cursor = new Date(start);
    cursor.setMinutes(0, 0, 0);
    if (cursor < start) cursor.setHours(cursor.getHours() + 1);
    while (cursor < end) {
        visit(cursor.getDay(), cursor.getHours());
        cursor.setHours(cursor.getHours() + 1);
    }
}

/**
 * Returns true if any hour covered by the event matches an "available" slot
 * in the user's weekly game-time template.
 *
 * Slots use the Sunday-first convention (0=Sun .. 6=Sat) — the same convention
 * as JS `Date.getDay()`. The server normalizes the DB's Monday-first storage
 * to Sunday-first before sending to the client (see
 * `api/src/users/game-time.service.ts`), so no day conversion is needed here.
 *
 * A slot counts as "available" when `status === 'available'` or `status` is
 * absent.
 *
 * @param slots - User's weekly game-time template slots (Sunday-first)
 * @param startTime - Event start as ISO string
 * @param endTime - Event end as ISO string
 * @returns true when the event intersects at least one available slot
 */
export function checkGameTimeOverlap(
    slots: Pick<GameTimeSlot, 'dayOfWeek' | 'hour' | 'status'>[],
    startTime: string,
    endTime: string,
): boolean {
    if (!slots.length) return false;
    const templateSet = new Set(
        slots
            .filter((s) => s.status === 'available' || !s.status)
            .map((s) => `${s.dayOfWeek}:${s.hour}`),
    );
    let found = false;
    walkEventHours(startTime, endTime, (dayOfWeek, hour) => {
        if (found) return;
        if (templateSet.has(`${dayOfWeek}:${hour}`)) found = true;
    });
    return found;
}
