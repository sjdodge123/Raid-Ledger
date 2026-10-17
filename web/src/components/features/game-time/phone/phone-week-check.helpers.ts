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
import type { GameTimeSlot, GameTimeTemplateInput } from '@raid-ledger/contract';
import { isSlotActive } from '../game-time-slot.utils';

/**
 * The drawer's sticky action bar (the comp's `.bar`) — shared by the week's
 * Save / Skip and the away view's add button, so the two footers match. No
 * safe-area padding here: the `BottomSheet` panel already clears the bottom
 * inset, and padding both doubled the gap on a notched phone (ROK-1640 review).
 */
export const STEP_FOOTER_BAR =
    '-mx-4 flex shrink-0 items-center gap-2 border-t border-edge bg-surface px-4 pt-2 pb-2';

/** The check's visible range — the comp's evening hours, 6pm through midnight. */
export const CHECK_HOURS: number[] = [17, 18, 19, 20, 21, 22, 23];

/**
 * The profile's range — all 24 hours, laid out from 6 AM so the evening never
 * wraps (ROK-1584 §3). The drawer only SHOWS the fitted evening by default; the
 * "Show earlier" / "Show later" bands reach the rest (`phone-window.helpers`).
 */
export const PROFILE_HOURS: number[] = [
    6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    18, 19, 20, 21, 22, 23, 0,
    1, 2, 3, 4, 5,
];

/**
 * The TEMPLATE view of the composite `useGameTime()` slots (review MAJOR 1).
 *
 * The composite carries event-only rows (`fromTemplate: false`, status
 * `committed`) and per-date overrides; only the viewer's own weekly hours are
 * editable here, and they are always `available` in the template — the same
 * projection the desktop editor makes in `use-game-time-editor.ts`.
 */
export function toTemplateSlots(slots: readonly GameTimeSlot[]): GameTimeSlot[] {
    return slots
        .filter((s) => s.fromTemplate !== false)
        .map((s) => ({ dayOfWeek: s.dayOfWeek, hour: s.hour, status: 'available' as const }));
}

/** What "Save my week" sends: active hours only, as bare day/hour pairs. */
export function toTemplateInput(slots: readonly GameTimeSlot[]): GameTimeTemplateInput['slots'] {
    return slots.filter(isSlotActive).map(({ dayOfWeek, hour }) => ({ dayOfWeek, hour }));
}

/** Order-independent identity for a week's ACTIVE hours, so a repaint that
 * lands on the same hours does not count as a change (review MINOR 6). */
export function slotsKey(slots: readonly GameTimeSlot[]): string {
    return slots
        .filter(isSlotActive)
        .map((s) => `${s.dayOfWeek}:${s.hour}`)
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
    /** Drop the draft and follow the server again. */
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
    // The draft retires itself once the server catches up to it (review MINOR
    // 4): a save only INVALIDATES, so dropping the draft on the mutation
    // callback would repaint the pre-save week until the refetch lands.
    const caughtUp = draft !== null && slotsKey(draft) === slotsKey(serverSlots);
    if (caughtUp) setDraft(null);
    return {
        slots: caughtUp ? serverSlots : (draft ?? serverSlots),
        dirty: !caughtUp && draft !== null,
        setDraft: apply,
        reset,
    };
}
