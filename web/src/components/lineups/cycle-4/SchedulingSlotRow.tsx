/**
 * Per-slot row for the ROK-1300 Scheduling composite.
 *
 * Renders one suggested time: the formatted datetime, voter avatars + count,
 * an optional conflict marker, the `+ Vote` toggle (viewers whose vote the
 * server would accept), a read-only `✓ Voted` mark once the poll has ended,
 * a "Sign in to vote" CTA for anonymous viewers of an open poll, and — as an
 * injected `menu` node — the organiser's ⋯ actions.
 *
 * ROK-1635 (AC3) deleted the inline cyan `Lock this time →` button that used
 * to live here: Lock is now one item of the SAME `SchedulingTimeMenu` the
 * leading card carries, so a row and the card offer one control set, not two.
 * Vote and "Doesn't work" stay directly on the row, one tap (AC4).
 *
 * The row is purely presentational — vote + lock callbacks are owned by the
 * composite so the threshold-confirm modal and reschedule-vs-navigate branch
 * stay in one place.
 */
import type { JSX, ReactNode } from 'react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../../../constants/api';
import { MemberAvatarGroup } from '../decided/MemberAvatarGroup';
import { SchedulingVoteControls } from './SchedulingVoteControls';
import { formatSlotTime } from './scheduling-slot-time';

export interface SchedulingSlotRowProps {
  slot: ScheduleSlotWithVotesDto;
  /** Viewer has voted YES on this slot. */
  voted: boolean;
  /** ROK-1617: viewer marked this time as NOT working for them. */
  noVoted: boolean;
  /** Titles of the viewer's existing events that conflict with this slot (ROK-1032). */
  conflictEventNames: string[];
  /** Interactions disabled (read-only poll). */
  readOnly: boolean;
  /**
   * ROK-1545 (F-07): the viewer may cast a vote at all. False on a terminal
   * poll and for a non-member of a PRIVATE lineup — the server rejects those
   * votes, so no affordance is rendered rather than one that fails on tap.
   */
  canVote: boolean;
  /**
   * ROK-1545 (review F4): the viewer has a session. An anonymous viewer is
   * `canVote: false` too, but the answer for them is "sign in", not silence —
   * the Discord→web funnel lands logged-out readers on an OPEN public poll.
   */
  signedIn: boolean;
  /**
   * ROK-1545: the viewer is not enrolled yet but the lineup is public, so
   * voting self-enrols them. The copy says so instead of silently adding them.
   */
  enrolByVoting: boolean;
  /**
   * ROK-1635 (AC3): the organiser's ⋯ menu for THIS time, built by
   * `SchedulingSlotList` from `SchedulingTimeMenu`. `undefined`/`null` for a
   * viewer who may not manage the poll — they see no trigger at all.
   */
  menu?: ReactNode;
  /**
   * ROK-1617 follow-up: a stance press on THIS slot is in flight. The ladder
   * drops a second press while one is running, so both controls read
   * `aria-disabled` rather than looking pressable and doing nothing.
   */
  pending?: boolean;
  onToggleVote: (slotId: number) => void;
  /** ROK-1617: press "doesn't work"; pressing it again clears the answer. */
  onToggleNo: (slotId: number) => void;
  /**
   * ROK-1635: kept on the interface (the ladder binding still supplies it and
   * `SchedulingSlotList` uses it to build {@link menu}) but no longer read
   * here — the row has no lock control of its own any more.
   */
  onLock?: (slot: ScheduleSlotWithVotesDto) => void;
}

/**
 * Join conflicting event titles into readable prose: "A", "A and B",
 * "A, B and C".
 *
 * ROK-1546 (AC3): the names used to live in a `title` tooltip with a "+N"
 * stand-in inline — invisible on touch, unreliable to assistive tech. Every
 * name is visible text now, so the list has to read as a sentence.
 */
function formatConflictList(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Voter summary: avatars + "N votes", plus the anti-vote tally (ROK-1617 AC5).
 *
 * The `no` count is rendered as its own clause rather than folded into the
 * vote number — "3 votes · 2 can't" is the whole story of a contested time,
 * and it is the same pair the net score the ladder orders on is computed from.
 */
function VoteSummary({ slot }: { slot: ScheduleSlotWithVotesDto }): JSX.Element {
  const count = slot.votes.length;
  const noCount = slot.noVotes?.length ?? 0;
  return (
    <div className="flex items-center gap-2">
      {count > 0 && (
        <MemberAvatarGroup
          members={slot.votes.map((v) => ({
            userId: v.userId,
            displayName: v.displayName,
            avatar: v.avatar,
            discordId: v.discordId,
            customAvatarUrl: v.customAvatarUrl,
          }))}
          max={4}
        />
      )}
      <span className="text-xs text-muted">
        {count === 1 ? '1 vote' : `${count} votes`}
      </span>
      {noCount > 0 && (
        <span
          data-testid="slot-no-count"
          className="text-xs text-dim"
        >{`· ${noCount} can’t`}</span>
      )}
    </div>
  );
}

/** Single suggested-time row — see file-level docstring. */
export function SchedulingSlotRow(props: SchedulingSlotRowProps): JSX.Element {
  const {
    slot,
    voted,
    noVoted,
    conflictEventNames,
    readOnly,
    canVote,
    signedIn,
    enrolByVoting,
    menu,
    pending,
    onToggleVote,
    onToggleNo,
  } = props;
  const { label, isPast } = formatSlotTime(slot.proposedTime);

  return (
    <div
      data-testid="schedule-slot"
      data-slot-id={slot.id}
      data-voted={voted ? 'true' : 'false'}
      data-no-voted={noVoted ? 'true' : 'false'}
      className="flex w-full flex-col gap-3 rounded-lg border border-edge bg-panel/40 p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">
          {label}
          {isPast && <span className="ml-1 text-[11px] text-muted">· past</span>}
          {voted && (
            <span
              role="img"
              className="ml-1.5 text-emerald-400"
              aria-label="You voted"
            >
              ✓
            </span>
          )}
          {noVoted && (
            <span
              role="img"
              className="ml-1.5 text-red-400"
              aria-label="You said this time does not work"
            >
              ✕
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <VoteSummary slot={slot} />
          {conflictEventNames.length > 0 && (
            <span
              data-testid="slot-conflicts"
              className="min-w-0 break-words text-[11px] text-amber-400"
            >
              ⚠ Conflicts with {formatConflictList(conflictEventNames)}
            </span>
          )}
        </div>
      </div>
      {/*
        ROK-1617: `flex-wrap` because a creator's open-poll row carries three
        controls now. Below `sm` each vote control is `w-full`, so they wrap
        one per line instead of squeezing three `whitespace-nowrap` labels
        onto a 320px line; on `sm+` every child is `sm:w-auto` and nothing
        wraps, so the desktop row is unchanged.
      */}
      <div
        data-testid="slot-actions"
        className="flex w-full flex-shrink-0 flex-wrap items-center gap-2 sm:w-auto"
      >
        {canVote && !isPast && (
          <SchedulingVoteControls
            label={label}
            voted={voted}
            noVoted={noVoted}
            enrolByVoting={enrolByVoting}
            pending={pending}
            noTestId="slot-no-toggle"
            onToggleVote={() => onToggleVote(slot.id)}
            onToggleNo={() => onToggleNo(slot.id)}
          />
        )}
        {!canVote && voted && (
          <span
            data-testid="slot-voted-mark"
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-300"
          >
            ✓ Voted
          </span>
        )}
        {!canVote && !readOnly && !signedIn && !isPast && (
          <a
            data-testid="slot-signin-cta"
            href={`${API_BASE_URL}/auth/discord`}
            aria-label={`Sign in to vote for ${label}`}
            className="min-h-[44px] sm:min-h-[36px] w-full sm:w-auto inline-flex items-center justify-center gap-1 rounded-md border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-emerald-500/60"
          >
            Sign in to vote
          </a>
        )}
        {/* ROK-1635: Lock moved inside this menu. `SchedulingTimeMenu` owns
            the past-time and expired-poll gates (ROK-1610), so a row whose
            time has passed gets no trigger at all. */}
        {menu}
      </div>
    </div>
  );
}
