/**
 * ROK-1640 / ROK-1655: closing an overlay with unsaved edits must not silently
 * discard them. Born in the game-time drawer; shared by Modal and BottomSheet.
 *
 * `requestClose` is what every close path calls (×, backdrop, swipe-down,
 * Escape, an explicit Cancel). Clean → `onClose` at once. Dirty → `confirming`
 * flips on and the caller renders `DiscardChangesConfirm`
 * (`components/ui/discard-changes-confirm`); `keep` dismisses it, `discard` closes.
 *
 * `blocked` holds for one macrotask after the confirm settles: Escape reaches
 * the confirm's `document` listener AND the sheet's `window` listener in one
 * dispatch, and the second must not re-open the confirm the first just closed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface DirtyCloseGuard {
    /** Every close path goes through this. */
    requestClose: () => void;
    /** True while "Discard your changes?" is on screen. */
    confirming: boolean;
    /** "Keep editing" — dismiss the confirm, keep the draft. */
    keep: () => void;
    /** "Discard" — close for real (the overlay unmounts, the draft goes with it). */
    discard: () => void;
}

/** See file docstring. */
export function useDirtyCloseGuard(isDirty: boolean, onClose: () => void): DirtyCloseGuard {
    const [confirming, setConfirming] = useState(false);
    const blocked = useRef(false);
    const timer = useRef<number | undefined>(undefined);
    useEffect(() => () => window.clearTimeout(timer.current), []);

    const settle = useCallback(() => {
        setConfirming(false);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => { blocked.current = false; }, 0);
    }, []);
    const requestClose = useCallback(() => {
        if (blocked.current) return;
        if (!isDirty) { onClose(); return; }
        blocked.current = true;
        setConfirming(true);
    }, [isDirty, onClose]);
    const discard = useCallback(() => { settle(); onClose(); }, [settle, onClose]);
    return { requestClose, confirming, keep: settle, discard };
}
