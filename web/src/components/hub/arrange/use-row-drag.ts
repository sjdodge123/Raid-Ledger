/**
 * ROK-1918 L6 — native HTML5 drag-and-drop for the arrange list (spec §2.4,
 * operator Q6: the browser's own drag on the row handle, no library). Desktop
 * with a fine pointer only — native DnD does not fire on touch, so phones keep
 * the Move up / Move down buttons, which stay the primary path everywhere.
 *
 * The source index lives in state, not in `dataTransfer` (it is unreadable
 * during `dragover`); `setData` is still called because Firefox will not start
 * a drag without it.
 */
import { useCallback, useState, type DragEvent } from 'react';
import { DESKTOP_MQ } from '../../../lib/breakpoints';

/** Native DnD does not fire on touch, and tablets get the phone layout (spec §2.4). */
export const DRAG_MQ = `${DESKTOP_MQ} and (pointer: fine)`;

export interface DragHandleProps {
    draggable: true;
    onDragStart: (e: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
}

export interface DropTargetProps {
    onDragOver: (e: DragEvent<HTMLElement>) => void;
    onDrop: (e: DragEvent<HTMLElement>) => void;
}

/** Where the 2px drop line sits on a row: above it, below it, or not at all. */
export type DropEdge = 'before' | 'after' | null;

/** What one arrange row needs to take part in a drag. */
export interface RowDragBinding {
    handle: DragHandleProps;
    target: DropTargetProps;
    dragging: boolean;
    edge: DropEdge;
}

/** Dropping on a row below the source lands after it; above lands before it — the same index `moveTo` uses. */
export function dropEdge(from: number | null, over: number | null, index: number): DropEdge {
    if (from === null || over !== index || from === index) return null;
    return from > index ? 'before' : 'after';
}

function handleFor(index: number, start: (index: number) => void, reset: () => void): DragHandleProps {
    return {
        draggable: true,
        onDragStart: (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));
            const row = e.currentTarget.closest('li');
            if (row) e.dataTransfer.setDragImage(row, 16, 16);
            start(index);
        },
        onDragEnd: reset,
    };
}

/** `bind(i)` → the handle + drop-target props and drop-line edge for row `i`. */
export function useRowDrag(onDrop: (from: number, to: number) => void): (index: number) => RowDragBinding {
    const [from, setFrom] = useState<number | null>(null);
    const [over, setOver] = useState<number | null>(null);
    const reset = useCallback(() => { setFrom(null); setOver(null); }, []);
    return useCallback((index: number): RowDragBinding => ({
        handle: handleFor(index, setFrom, reset),
        target: {
            onDragOver: (e) => {
                if (from === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setOver(index);
            },
            onDrop: (e) => {
                if (from === null) return;
                e.preventDefault();
                onDrop(from, index);
                reset();
            },
        },
        dragging: from === index,
        edge: dropEdge(from, over, index),
    }), [from, over, onDrop, reset]);
}
