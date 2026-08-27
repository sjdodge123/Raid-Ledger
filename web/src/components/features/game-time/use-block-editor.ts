import { useCallback, useRef, useState } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import {
    findBlockAt, setBlockRange, moveBlock, maxEndIndex, minStartIndex, type SlotBlock,
} from './slot-blocks.utils';

/** Movement past this many px means the gesture was a drag, not a tap. */
const TAP_SLOP = 8;
/** Hours covered by a block created from a tap on empty space. */
export const DEFAULT_BLOCK_HOURS = 2;

type Gesture =
    | { kind: 'resize'; pointerId: number; edge: 'start' | 'end'; block: SlotBlock; y0: number; snapshot: GameTimeSlot[] }
    | { kind: 'move'; pointerId: number; block: SlotBlock; y0: number; snapshot: GameTimeSlot[] }
    | { kind: 'tap'; pointerId: number; dayOfWeek: number; index: number; x0: number; y0: number };

export interface BlockEditorApi {
    selection: SlotBlock | null;
    isDragging: boolean;
    beginHandle: (e: React.PointerEvent, block: SlotBlock, edge: 'start' | 'end') => void;
    beginBlock: (e: React.PointerEvent, block: SlotBlock) => void;
    beginEmpty: (e: React.PointerEvent, dayOfWeek: number, index: number) => void;
    handleMove: (e: React.PointerEvent) => void;
    handleUp: (e: React.PointerEvent) => void;
    handleCancel: (e: React.PointerEvent) => void;
    adjust: (edge: 'start' | 'end', delta: number) => void;
    removeSelected: () => void;
    clearSelection: () => void;
}

/**
 * Clamped bounds for moving one edge of a block by `delta` rows. Shared by the
 * handle drag and the inspector stepper so the two can never disagree about
 * where a block is allowed to end up: at least one hour long, and never across
 * a blocked or committed hour.
 */
export function edgeBounds(
    slots: GameTimeSlot[], block: SlotBlock, edge: 'start' | 'end', delta: number, hours: number[],
): { start: number; end: number } {
    const day = block.dayOfWeek;
    if (edge === 'start') {
        const floor = minStartIndex(slots, day, block.endIndex, hours);
        return { start: Math.max(floor, Math.min(block.endIndex - 1, block.startIndex + delta)), end: block.endIndex };
    }
    const ceiling = maxEndIndex(slots, day, block.startIndex, hours);
    return { start: block.startIndex, end: Math.min(ceiling, Math.max(block.startIndex + 1, block.endIndex + delta)) };
}

const isSame = (a: SlotBlock | null, b: SlotBlock): boolean =>
    !!a && a.dayOfWeek === b.dayOfWeek && a.startIndex === b.startIndex && a.endIndex === b.endIndex;

/**
 * Block-editing gestures for the game-time grid (ROK-1426).
 *
 * Selection is the gate: nothing mutates on first contact, so the grid can keep
 * `touch-action: pan-y` and the page always scrolls. Only a selected block and
 * its handles opt out of scrolling. There is deliberately no pointerType branch
 * — a mouse and a finger run exactly the same path.
 *
 * Every drag resolves against the slot snapshot taken at pointerdown, so a move
 * is a pure function of (snapshot, steps) and repeated pointermove events cannot
 * accumulate drift.
 */
export function useBlockEditor(
    slots: GameTimeSlot[],
    onChange: ((slots: GameTimeSlot[]) => void) | undefined,
    hours: number[],
    rowHeight: number | undefined,
): BlockEditorApi {
    const [selection, setSelection] = useState<SlotBlock | null>(null);
    const [isDragging, setDragging] = useState(false);
    const gesture = useRef<Gesture | null>(null);

    /** Apply new slots and re-seat the selection onto whatever block now covers `anchor`. */
    const commit = useCallback((next: GameTimeSlot[], dayOfWeek: number, anchor: number) => {
        if (next !== slots) onChange?.(next);
        setSelection(findBlockAt(next, dayOfWeek, anchor, hours));
    }, [slots, onChange, hours]);

    const steps = useCallback((e: React.PointerEvent, y0: number): number => (
        rowHeight ? Math.round((e.clientY - y0) / rowHeight) : 0
    ), [rowHeight]);

    const beginHandle = useCallback((e: React.PointerEvent, block: SlotBlock, edge: 'start' | 'end') => {
        gesture.current = { kind: 'resize', pointerId: e.pointerId, edge, block, y0: e.clientY, snapshot: slots };
        setDragging(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
    }, [slots]);

    const beginBlock = useCallback((e: React.PointerEvent, block: SlotBlock) => {
        if (!isSame(selection, block)) { setSelection(block); return; }
        // Already selected, so this block owns the pointer and the gesture is a move.
        gesture.current = { kind: 'move', pointerId: e.pointerId, block, y0: e.clientY, snapshot: slots };
        setDragging(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.preventDefault();
    }, [selection, slots]);

    const beginEmpty = useCallback((e: React.PointerEvent, dayOfWeek: number, index: number) => {
        // No capture and no preventDefault: if this becomes a drag, the browser
        // scrolls the page exactly as it would anywhere else on the page.
        gesture.current = { kind: 'tap', pointerId: e.pointerId, dayOfWeek, index, x0: e.clientX, y0: e.clientY };
    }, []);

    /** Re-derive the whole edit from `base`, so repeated moves cannot drift. */
    const applyEdge = useCallback((
        base: GameTimeSlot[], block: SlotBlock, edge: 'start' | 'end', delta: number,
    ) => {
        const day = block.dayOfWeek;
        const { start, end } = edgeBounds(base, block, edge, delta, hours);
        if (start === block.startIndex && end === block.endIndex) { commit(base, day, start); return; }
        const cleared = setBlockRange(base, day, block.startIndex, block.endIndex, false, hours);
        commit(setBlockRange(cleared, day, start, end, true, hours), day, start);
    }, [hours, commit]);

    const handleMove = useCallback((e: React.PointerEvent) => {
        const g = gesture.current;
        if (!g || g.pointerId !== e.pointerId) return;
        if (g.kind === 'tap') {
            if (Math.abs(e.clientY - g.y0) > TAP_SLOP || Math.abs(e.clientX - g.x0) > TAP_SLOP) gesture.current = null;
            return;
        }
        const delta = steps(e, g.y0);
        if (g.kind === 'resize') applyEdge(g.snapshot, g.block, g.edge, delta);
        else commit(moveBlock(g.snapshot, g.block, g.block.startIndex + delta, hours), g.block.dayOfWeek, g.block.startIndex + delta);
        e.preventDefault();
    }, [steps, applyEdge, commit, hours]);

    const handleUp = useCallback((e: React.PointerEvent) => {
        const g = gesture.current;
        if (!g || g.pointerId !== e.pointerId) return;
        gesture.current = null;
        setDragging(false);
        if (g.kind !== 'tap') return;
        const end = Math.min(hours.length, g.index + DEFAULT_BLOCK_HOURS);
        commit(setBlockRange(slots, g.dayOfWeek, g.index, end, true, hours), g.dayOfWeek, g.index);
    }, [hours, slots, commit]);

    const handleCancel = useCallback((e: React.PointerEvent) => {
        // The browser took the gesture to scroll the page. Exactly what we want.
        if (gesture.current?.pointerId === e.pointerId) { gesture.current = null; setDragging(false); }
    }, []);

    const adjust = useCallback((edge: 'start' | 'end', delta: number) => {
        if (selection) applyEdge(slots, selection, edge, delta);
    }, [selection, slots, applyEdge]);

    const removeSelected = useCallback(() => {
        if (!selection) return;
        onChange?.(setBlockRange(slots, selection.dayOfWeek, selection.startIndex, selection.endIndex, false, hours));
        setSelection(null);
    }, [selection, slots, hours, onChange]);

    const clearSelection = useCallback(() => setSelection(null), []);

    return {
        selection, isDragging, beginHandle, beginBlock, beginEmpty,
        handleMove, handleUp, handleCancel, adjust, removeSelected, clearSelection,
    };
}
