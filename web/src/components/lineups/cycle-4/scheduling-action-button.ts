/**
 * The ONE button recipe for the scheduling hero's creator/operator actions
 * (ROK-1582).
 *
 * Add Participants / Remind Voters / Cancel Poll used to carry three copies of
 * a 10px uppercase outline pill (~22px tall) that stacked one-per-line and hung
 * past the hero card's right edge on a phone. They now share this recipe: a
 * 44px phone target (36px from `sm`) using the same secondary treatment as
 * `SchedulingBetterTimeTrigger` — a solid `border-edge-strong` outline on
 * `bg-surface` with `text-foreground`.
 *
 * Below `sm` the three are equal `flex-1` columns of ONE full-width row
 * ({@link SCHEDULING_ACTION_ROW}); from `sm` up they sit inline, right-aligned,
 * at their intrinsic width. Colours are tokens (or the red family `index.css`
 * remaps per scheme), so both `default-dark` and `default-light` are covered.
 */

/** Shared geometry/typography every scheduling hero action must carry. */
export const SCHEDULING_ACTION_BUTTON_BASE =
  'inline-flex flex-1 items-center justify-center gap-1 whitespace-nowrap ' +
  'rounded-lg border bg-surface px-3 py-2 text-sm font-medium ' +
  'min-h-[44px] sm:min-h-[36px] sm:flex-none transition-colors ' +
  'disabled:opacity-50';

/** Neutral (secondary) scheduling action — Add Participants, Remind Voters. */
export const SCHEDULING_ACTION_BUTTON =
  `${SCHEDULING_ACTION_BUTTON_BASE} border-edge-strong text-foreground hover:bg-overlay`;

/**
 * Destructive scheduling action — Cancel Poll. Same geometry, red family.
 * `border-red-500/30` + `hover:bg-red-500/20` are the two red utilities
 * `index.css` remaps for the light schemes (`:710`, `:698`), so the hover
 * tint is not a raw 10% red on white.
 */
export const SCHEDULING_ACTION_BUTTON_DANGER =
  `${SCHEDULING_ACTION_BUTTON_BASE} border-red-500/30 text-red-400 hover:bg-red-500/20`;

/**
 * Wrapper for the three actions: one full-width row on a phone, an inline
 * right-aligned cluster from `sm` up. `empty:hidden` (review minor-1): for a
 * plain member or a read-only poll all three children render null, and an
 * empty `w-full` row would still wrap the badge cluster onto a new line.
 */
export const SCHEDULING_ACTION_ROW =
  'flex w-full items-stretch gap-2 empty:hidden sm:w-auto sm:items-center sm:justify-end';

/**
 * ROK-1584 (H1-b): the phone hero's full-width "Manage poll ⋯" row. Below the
 * phone breakpoint the three actions above leave the hero's header cluster and
 * live behind this single 44px row, which opens {@link SchedulingManageSheet}.
 */
export const SCHEDULING_MANAGE_BUTTON =
  'flex w-full items-center justify-between gap-2 whitespace-nowrap ' +
  'rounded-lg border border-edge-strong bg-surface px-3 py-2 ' +
  'text-sm font-medium text-foreground min-h-[44px] ' +
  'transition-colors hover:bg-overlay';

/** One 52px row inside the Manage poll sheet (ROK-1584). */
export const SCHEDULING_SHEET_ROW_BASE =
  'flex w-full min-h-[52px] items-center justify-between gap-3 ' +
  'rounded-lg px-3 py-2 text-left text-sm font-medium ' +
  'transition-colors disabled:opacity-50';

/** Neutral sheet row — Add Participants, Remind Voters. */
export const SCHEDULING_SHEET_ROW =
  `${SCHEDULING_SHEET_ROW_BASE} text-foreground hover:bg-overlay`;

/** Destructive sheet row — Cancel Poll. Same red family as the inline button. */
export const SCHEDULING_SHEET_ROW_DANGER =
  `${SCHEDULING_SHEET_ROW_BASE} text-red-400 hover:bg-red-500/20`;
