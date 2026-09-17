import type { KeyboardEvent } from 'react';

/** Day / hour-index deltas per key; Home / End are handled as row jumps. */
const MOVES: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
};

/** The (day, hour) a key moves to from a cell, or null when the key is not a move. */
function targetOf(key: string, day: number, hour: number, hours: number[]): [number, number] | null {
    if (key === 'Home') return [0, hour];
    if (key === 'End') return [6, hour];
    const move = MOVES[key];
    if (!move) return null;
    const index = hours.indexOf(hour) + move[1];
    const nextDay = Math.min(6, Math.max(0, day + move[0]));
    const nextHour = hours[Math.min(hours.length - 1, Math.max(0, index))];
    return [nextDay, nextHour];
}

/**
 * Arrow-key focus movement inside the week grid (ROK-1588, Q9): plain buttons,
 * no `role="grid"` roving tabindex — a key finds the neighbouring cell by its
 * `data-day` / `data-hour` and focuses it. Edges clamp. Read-only tiles (no
 * buttons) are skipped because only buttons are looked up.
 *
 * @param event The grid container's keydown.
 * @param hours The visible hours in display order (rows).
 */
export function moveWeekFocus(event: KeyboardEvent<HTMLElement>, hours: number[]): void {
    const from = (event.target as HTMLElement).closest<HTMLElement>('button[data-day][data-hour]');
    if (!from) return;
    const target = targetOf(event.key, Number(from.dataset.day), Number(from.dataset.hour), hours);
    if (!target) return;
    event.preventDefault();
    const selector = `button[data-day="${target[0]}"][data-hour="${target[1]}"]`;
    event.currentTarget.querySelector<HTMLElement>(selector)?.focus();
}
