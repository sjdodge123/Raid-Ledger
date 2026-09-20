/**
 * Keyboard focus follows the leading time across a swap (ROK-1635 §4.1/§4.6).
 *
 * AC1 renders the leading time ONCE — on the leader card — so a swap unmounts
 * the ladder row that names the winning time. A keyboard user standing on that
 * row's "+ Vote" or its ⋯ trigger is dropped onto `<body>`: their next Tab
 * restarts at the top of the document. The same hand-over happens in reverse
 * when the card's time loses the lead and returns to the ladder.
 *
 * This hook moves focus to the EQUIVALENT control on the surface the time
 * moved to — vote → vote, ⋯ → ⋯ — and does nothing at all when focus was
 * somewhere else (stealing focus from an unrelated control is worse than the
 * bug it fixes). Its own module so `SchedulingComposite` does not grow an
 * effect (§4.8).
 */
import { useEffect, useRef } from 'react';

/** A ladder row's control → the leader card's equivalent, by `data-testid`. */
const TO_CARD: Record<string, string> = {
    'slot-vote-toggle': 'scheduling-leader-vote',
    'slot-no-toggle': 'scheduling-leader-no',
    'scheduling-slot-menu': 'scheduling-leader-menu',
};

/** The leader card's control → a ladder row's equivalent (the reverse trip). */
const TO_ROW: Record<string, string> = {
    'scheduling-leader-vote': 'slot-vote-toggle',
    'scheduling-leader-no': 'slot-no-toggle',
    'scheduling-leader-menu': 'scheduling-slot-menu',
};

/** `data-testid` of an element, or `''` when it carries none. */
function testId(el: Element): string {
    return el.getAttribute('data-testid') ?? '';
}

/** Focus the first of `selectors` that is on the page; no-op when none is. */
function focusFirst(selectors: string[]): void {
    for (const selector of selectors) {
        const el = document.querySelector<HTMLElement>(selector);
        if (el) {
            el.focus();
            return;
        }
    }
}

/**
 * The row that had focus was just promoted onto the card — follow it up.
 *
 * Only fires when focus actually fell to `<body>` (the row unmounted under it)
 * AND the unmounted row is the one that now leads: any other detached element
 * is someone else's business.
 */
function followRowToCard(lost: HTMLElement, leaderSlotId: number | null): void {
    if (document.activeElement !== document.body) return;
    const rowId = lost.closest('[data-slot-id]')?.getAttribute('data-slot-id');
    if (rowId === null || rowId !== String(leaderSlotId)) return;
    focusFirst(
        [TO_CARD[testId(lost)], 'scheduling-leader-menu', 'scheduling-leader-vote']
            .filter(Boolean)
            .map((id) => `[data-testid="${id}"]`),
    );
}

/**
 * Focus is still where this hook left it — either `lost` is focused, or it
 * unmounted under the viewer and dropped focus onto `<body>`.
 *
 * Both happen on the card: its vote controls persist across a swap, while its
 * ⋯ trigger is keyed by slot id (§4.1, so an open popover cannot survive onto
 * a different time) and therefore unmounts. Anything else focused means the
 * viewer moved on and this hook must not touch them.
 */
function stillOurs(lost: HTMLElement): boolean {
    if (document.activeElement === lost) return true;
    return (
        document.activeElement === document.body &&
        !document.body.contains(lost)
    );
}

/** The card control that had focus lost the lead — follow its time back down. */
function followCardToRow(lost: HTMLElement, previousSlotId: number | null): void {
    if (!stillOurs(lost) || previousSlotId === null) return;
    const target = TO_ROW[testId(lost)];
    if (!target) return;
    focusFirst([`[data-slot-id="${previousSlotId}"] [data-testid="${target}"]`]);
}

/**
 * Keep keyboard focus on the control the viewer was using when the lead
 * changes — see file-level docstring.
 *
 * @param leaderSlotId - The slot the leader card names; `null` when none leads.
 */
export function useLeaderFocusRescue(leaderSlotId: number | null): void {
    const focused = useRef<HTMLElement | null>(null);
    useEffect(() => {
        const track = (e: FocusEvent): void => {
            if (e.target instanceof HTMLElement) focused.current = e.target;
        };
        document.addEventListener('focusin', track);
        return () => document.removeEventListener('focusin', track);
    }, []);

    /** Previous leader; `undefined` until the first render lands (no rescue). */
    const previous = useRef<number | null | undefined>(undefined);
    useEffect(() => {
        const before = previous.current;
        previous.current = leaderSlotId;
        const lost = focused.current;
        if (before === undefined || before === leaderSlotId || !lost) return;
        /* Which SURFACE the control belongs to decides the trip, not whether
           it is still mounted: the card's ⋯ is keyed by its slot id, so it
           unmounts on a swap exactly like a row does. Routing that by
           liveness sent it down `followRowToCard`, which looks for a
           `data-slot-id` ancestor the card does not have — and focus fell to
           `<body>`. */
        if (TO_ROW[testId(lost)]) followCardToRow(lost, before);
        else followRowToCard(lost, leaderSlotId);
    }, [leaderSlotId]);
}
