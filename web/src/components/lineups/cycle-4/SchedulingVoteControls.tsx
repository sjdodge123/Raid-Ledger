/**
 * The scheduling ballot's two answers for ONE time: `+ Vote` and
 * `Doesn’t work` (ROK-1617).
 *
 * Lifted verbatim out of `SchedulingSlotRow` for the ROK-1617 follow-up
 * (item B) so the leading card can offer the same two presses the ladder row
 * does — operator, 2026-09-20: "I should be able to vote/antivote on the lead
 * time card itself." It is a **lift, not a copy**: one component, one set of
 * pressed states, one pair of accessible names, both placements bound to the
 * same ladder handlers (`use-scheduling-ladder.ts`), so the two surfaces
 * cannot disagree and there is no second mutation path. No new pattern —
 * only the control's location is new.
 *
 * New pattern note (carried over with the control): `components/ui` has no
 * toggle/segmented primitive, and the §4.3 chip is a `rounded-full` pill that
 * does not sit next to the square `+ Vote` button. The pressed NO state uses
 * the house danger tint — `bg-red-500/10` + `border-red-500/30` +
 * `text-red-400` — and the pressed YES the solid `bg-emerald-600`; `red` and
 * `emerald` are sanctioned accents (`docs/design-system.md` §2.2) that
 * `index.css` repaints for the six light schemes, so neither is dark-only.
 * The `✓` / `✕` glyphs stay regardless: AC5 says the three answers must be
 * distinguishable without colour.
 *
 * Renders a FRAGMENT of two buttons, never a wrapper — each placement owns
 * its own flex container (the row's `slot-actions`, the card's actions row).
 */
import type { JSX } from 'react';

export interface SchedulingVoteControlsProps {
  /** Formatted slot time — every accessible name names the time it answers. */
  label: string;
  /** Viewer holds a YES on this slot. */
  voted: boolean;
  /** Viewer marked this time as NOT working for them. */
  noVoted: boolean;
  /** Voting self-enrols the viewer (public lineup, not a member yet). */
  enrolByVoting: boolean;
  /**
   * ROK-1617 follow-up (S0 suggestion 2): a press on this slot is in flight.
   * The ladder drops a second press on a slot it is already toggling, so the
   * control must SAY so — `aria-disabled` plus a dimmed face — instead of
   * looking pressable and silently doing nothing.
   */
  pending?: boolean;
  /** `data-testid` for the YES control; omitted in the ladder row. */
  voteTestId?: string;
  /** `data-testid` for the NO control (row: `slot-no-toggle`). */
  noTestId: string;
  onToggleVote: () => void;
  onToggleNo: () => void;
}

/** Shared geometry: ≥44px touch target on phones, compact from `sm` up. */
const BASE =
  'min-h-[44px] sm:min-h-[36px] w-full sm:w-auto inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium transition-colors';

/** Dimmed, non-interactive face while this slot's press is in flight. */
const PENDING = 'opacity-60 cursor-not-allowed';

/**
 * Parity with the pre-extraction row (review item 5): only the YES button
 * carried `disabled:*` on `origin/main`, and nothing renders it `disabled`
 * today (the in-flight state is `aria-disabled` + {@link PENDING}) — but a
 * lift must not silently drop a class, and a future `disabled` press on the
 * vote button would otherwise look enabled. `whitespace-nowrap` is kept on
 * BOTH (main's NO button had it): the leading card lays the two out in a
 * fixed two-column grid, where a wrapped label would break the row height.
 */
const VOTE_DISABLED = 'disabled:opacity-50 disabled:cursor-not-allowed';

/** The `+ Vote` / `✓ Voted` toggle. */
function VoteButton(props: SchedulingVoteControlsProps): JSX.Element {
  const { label, voted, enrolByVoting, pending, voteTestId, onToggleVote } =
    props;
  return (
    <button
      type="button"
      data-testid={voteTestId}
      aria-pressed={voted}
      aria-disabled={pending ? true : undefined}
      aria-label={
        enrolByVoting
          ? `Vote for ${label} — this adds you to the poll`
          : `${voted ? 'Remove vote for' : 'Vote for'} ${label}`
      }
      onClick={() => {
        if (!pending) onToggleVote();
      }}
      className={`${BASE} ${VOTE_DISABLED} ${
        voted
          ? 'border-emerald-500 bg-emerald-600 text-white'
          : 'border-edge bg-surface text-foreground hover:border-emerald-500/60'
      } ${pending ? PENDING : ''}`}
    >
      {voted ? '✓ Voted' : enrolByVoting ? '+ Vote & join' : '+ Vote'}
    </button>
  );
}

/** The `Doesn’t work` / `✕ Doesn’t work` toggle (ROK-1617 AC4). */
function NoVoteButton(props: SchedulingVoteControlsProps): JSX.Element {
  const { label, noVoted, pending, noTestId, onToggleNo } = props;
  return (
    <button
      type="button"
      data-testid={noTestId}
      aria-pressed={noVoted}
      aria-disabled={pending ? true : undefined}
      aria-label={
        noVoted
          ? `${label} does not work for you — press to clear`
          : `Mark ${label} as not working for you`
      }
      onClick={() => {
        if (!pending) onToggleNo();
      }}
      className={`${BASE} ${
        noVoted
          ? 'border-red-500/30 bg-red-500/10 text-red-400'
          : 'border-edge bg-surface text-muted hover:border-edge-strong hover:text-foreground'
      } ${pending ? PENDING : ''}`}
    >
      {noVoted ? '✕ Doesn’t work' : 'Doesn’t work'}
    </button>
  );
}

/** Both ballot answers for one time — see file-level docstring. */
export function SchedulingVoteControls(
  props: SchedulingVoteControlsProps,
): JSX.Element {
  return (
    <>
      <VoteButton {...props} />
      <NoVoteButton {...props} />
    </>
  );
}
