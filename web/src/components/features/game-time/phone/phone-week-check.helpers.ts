/**
 * Draft bookkeeping for the phone week editor's step 1 (ROK-1569).
 *
 * The editor paints into a LOCAL draft so a half-finished week is never sent to
 * the server, and "Save my week" stays disabled until the draft actually
 * differs from the saved copy. An untouched draft is `null`, which means the
 * component simply renders the server's slots — so a refetch (another device, a
 * successful save) lands immediately without a reset effect racing the user.
 */
import { useCallback, useState } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';

/** The check's visible range — the comp's evening hours, 6pm through midnight. */
export const CHECK_HOURS: number[] = [17, 18, 19, 20, 21, 22, 23];

/** Order-independent identity for a week, so a repaint that lands on the same
 * hours does not count as a change. */
export function slotsKey(slots: readonly GameTimeSlot[]): string {
    return slots
        .map((s) => `${s.dayOfWeek}:${s.hour}:${s.status}`)
        .sort()
        .join(',');
}

export interface PhoneWeekDraft {
    /** What the editor renders — the draft if touched, else the server copy. */
    slots: GameTimeSlot[];
    /** True when the draft differs from the saved week (drives Save). */
    dirty: boolean;
    /** The editor's `onChange`. */
    setDraft: (next: GameTimeSlot[]) => void;
    /** Drop the draft and follow the server again (after a successful save). */
    reset: () => void;
}

/**
 * Hold the editor's draft week against the saved one.
 *
 * @param serverSlots The saved template from `useGameTime()`.
 * @returns The slots to render, whether they are dirty, and the two setters.
 */
export function usePhoneWeekDraft(serverSlots: GameTimeSlot[]): PhoneWeekDraft {
    const [draft, setDraft] = useState<GameTimeSlot[] | null>(null);
    const reset = useCallback(() => setDraft(null), []);
    const apply = useCallback((next: GameTimeSlot[]) => setDraft(next), []);
    return {
        slots: draft ?? serverSlots,
        dirty: draft !== null && slotsKey(draft) !== slotsKey(serverSlots),
        setDraft: apply,
        reset,
    };
}
