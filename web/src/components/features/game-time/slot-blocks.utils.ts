import type { GameTimeSlot } from '@raid-ledger/contract';
import { isSlotActive } from './game-time-slot.utils';

/**
 * Block model for the game-time editor (ROK-1426).
 *
 * Availability is edited as contiguous blocks rather than painted cells, but it
 * is still STORED as GameTimeSlot[] — blocks are derived from contiguous runs on
 * every render, so there is no contract change and no second source of truth.
 *
 * All indices are positions in the visible-hours array, never raw hour numbers:
 * hour ranges can wrap (e.g. [9, 2] renders 9..23 then 0..1), so "the row below"
 * is only meaningful as an index.
 *
 * Blocked/committed slots are never modified, matching toggleAllDaySlots.
 */
export interface SlotBlock {
    dayOfWeek: number;
    /** Inclusive index into the visible-hours array. */
    startIndex: number;
    /** Exclusive index into the visible-hours array. */
    endIndex: number;
}

function activeHours(slots: GameTimeSlot[], dayOfWeek: number): Set<number> {
    return new Set(
        slots.filter((s) => s.dayOfWeek === dayOfWeek && isSlotActive(s)).map((s) => s.hour),
    );
}

function lockedHours(slots: GameTimeSlot[], dayOfWeek: number): Set<number> {
    return new Set(
        slots.filter((s) => s.dayOfWeek === dayOfWeek && s.status && !isSlotActive(s)).map((s) => s.hour),
    );
}

/** Visible-hour indices that are blocked/committed and therefore immovable. */
export function lockedIndices(slots: GameTimeSlot[], dayOfWeek: number, hours: number[]): Set<number> {
    const locked = lockedHours(slots, dayOfWeek);
    const out = new Set<number>();
    hours.forEach((h, i) => { if (locked.has(h)) out.add(i); });
    return out;
}

/** Contiguous runs of active slots for one day, in visible-hour index space. */
export function deriveBlocks(slots: GameTimeSlot[], dayOfWeek: number, hours: number[]): SlotBlock[] {
    const active = activeHours(slots, dayOfWeek);
    const blocks: SlotBlock[] = [];
    let open: SlotBlock | null = null;
    hours.forEach((h, i) => {
        if (!active.has(h)) { open = null; return; }
        if (open && open.endIndex === i) open.endIndex = i + 1;
        else { open = { dayOfWeek, startIndex: i, endIndex: i + 1 }; blocks.push(open); }
    });
    return blocks;
}

/** Every block across all seven days, for rendering the block layer. */
export function deriveAllBlocks(slots: GameTimeSlot[], hours: number[]): SlotBlock[] {
    const out: SlotBlock[] = [];
    for (let day = 0; day < 7; day++) out.push(...deriveBlocks(slots, day, hours));
    return out;
}

/**
 * The block covering a given index, or null. Used to re-seat the selection after
 * a mutation: resizing into a neighbour merges the two, and the selection has to
 * follow the merged result rather than a range that no longer exists.
 */
export function findBlockAt(
    slots: GameTimeSlot[], dayOfWeek: number, index: number, hours: number[],
): SlotBlock | null {
    return deriveBlocks(slots, dayOfWeek, hours)
        .find((b) => index >= b.startIndex && index < b.endIndex) ?? null;
}

/**
 * Set a contiguous index range active or inactive. Locked hours inside the range
 * are skipped, never overwritten — so a range spanning one produces two blocks
 * rather than silently clobbering a committed slot.
 *
 * The `locked` filter is defense-in-depth: a locked hour is by definition already
 * a slot, so `existing` would skip it on the add path and `isSlotActive` would
 * spare it on the clear path. Both guards are kept because dropping either one
 * makes correctness depend on a non-obvious property of the other.
 */
export function setBlockRange(
    slots: GameTimeSlot[], dayOfWeek: number,
    startIndex: number, endIndex: number, active: boolean, hours: number[],
): GameTimeSlot[] {
    const locked = lockedHours(slots, dayOfWeek);
    const target = new Set<number>();
    for (let i = Math.max(0, startIndex); i < Math.min(hours.length, endIndex); i++) {
        if (!locked.has(hours[i])) target.add(hours[i]);
    }
    if (target.size === 0) return slots;

    if (!active) {
        return slots.filter((s) => !(s.dayOfWeek === dayOfWeek && target.has(s.hour) && isSlotActive(s)));
    }
    const existing = new Set(slots.filter((s) => s.dayOfWeek === dayOfWeek).map((s) => s.hour));
    const toAdd = [...target]
        .filter((h) => !existing.has(h))
        .map((h) => ({ dayOfWeek, hour: h, status: 'available' as const }));
    return toAdd.length ? [...slots, ...toAdd] : slots;
}

/** Furthest exclusive end reachable from startIndex without crossing a locked hour. */
export function maxEndIndex(
    slots: GameTimeSlot[], dayOfWeek: number, startIndex: number, hours: number[],
): number {
    const locked = lockedIndices(slots, dayOfWeek, hours);
    for (let i = startIndex; i < hours.length; i++) if (locked.has(i)) return i;
    return hours.length;
}

/** Furthest inclusive start reachable from endIndex without crossing a locked hour. */
export function minStartIndex(
    slots: GameTimeSlot[], dayOfWeek: number, endIndex: number, hours: number[],
): number {
    const locked = lockedIndices(slots, dayOfWeek, hours);
    for (let i = endIndex - 1; i >= 0; i--) if (locked.has(i)) return i + 1;
    return 0;
}

/**
 * Move a block to a new start index, keeping its length. Returns the slots
 * unchanged when the destination would cross a locked hour, so a drag can never
 * partially apply.
 */
export function moveBlock(
    slots: GameTimeSlot[], block: SlotBlock, newStartIndex: number, hours: number[],
): GameTimeSlot[] {
    const length = block.endIndex - block.startIndex;
    const start = Math.max(0, Math.min(hours.length - length, newStartIndex));
    if (start === block.startIndex) return slots;

    const cleared = setBlockRange(slots, block.dayOfWeek, block.startIndex, block.endIndex, false, hours);
    const locked = lockedIndices(cleared, block.dayOfWeek, hours);
    for (let i = start; i < start + length; i++) if (locked.has(i)) return slots;
    return setBlockRange(cleared, block.dayOfWeek, start, start + length, true, hours);
}
