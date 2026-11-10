/**
 * Tailwind class strings for the group availability marks (ROK-1587/1588).
 *
 * Literal strings, never interpolated widths — Tailwind only generates classes
 * it can see verbatim. Token classes only (`busy`, `slot`, `success`,
 * `foreground`, `edge`), so every scheme repaints them; the picked ring uses
 * the `success` token for parity with the phone's Suggested block (Q15) —
 * ROK-1586 moved it off the raw `emerald-500` family.
 */

/** The desktop week cell's 4px purple "someone is busy" left edge. */
export const BUSY_EDGE_4 = 'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-busy '
    + 'before:content-[""]';

/** The phone day cell's 5px busy edge (same mark, the phone's wider row). */
export const BUSY_EDGE_5 = 'before:absolute before:inset-y-0 before:left-0 before:w-[5px] before:bg-busy '
    + 'before:content-[""]';

/** A plain week cell's hairlines. */
export const WEEK_CELL_EDGES = 'border-l border-t border-edge-subtle';

/** A poll slot starts here: 2px dashed slot outline, inset 3px. */
export const SLOT_MARK = 'outline-2 outline-dashed outline-slot -outline-offset-[3px]';

/** The viewer's draft pick. */
export const PICKED_MARK = 'ring-2 ring-inset ring-success';

/** A cell that cannot be picked (Reschedule: past, or the current start). */
export const DISABLED_MARK = 'cursor-not-allowed opacity-50';

/**
 * ROK-2167: the chip the "N free · N busy · N stale" count sits on, in the
 * desktop week cell AND the phone day cell — the ROK-2165 `bg-surface/NN`
 * label-chip pattern. Straight on the strongest heat fills the count was 3.5:1
 * (busy down to ~1.5:1) in dark. It never truncates (operator ruling
 * 2026-11-10, option A): a line wider than the cap wraps between clauses
 * (`GroupCountClauses`), a two-line chip is 24px tall; `py-px` keeps the
 * descenders on the chip at `leading-none`.
 * Measured by `heatmap-count-chip.guard.test.ts`.
 */
export const COUNT_CHIP = 'max-w-[calc(100%-10px)] whitespace-normal rounded bg-surface/80 px-1 py-px';

/** Flags a week cell's classes derive from. */
export interface WeekCellFlags {
    busy: boolean;
    slot: boolean;
    picked: boolean;
    disabled: boolean;
}

/** The full class list for one desktop week cell. */
export function weekCellClass(flags: WeekCellFlags): string {
    return [
        'relative h-10 min-w-0 text-left',
        WEEK_CELL_EDGES,
        flags.busy ? BUSY_EDGE_4 : '',
        flags.slot ? SLOT_MARK : '',
        flags.picked ? PICKED_MARK : '',
        flags.disabled ? DISABLED_MARK : '',
    ].filter(Boolean).join(' ');
}
