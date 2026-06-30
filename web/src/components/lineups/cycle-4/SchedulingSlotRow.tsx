/**
 * Per-slot row for the ROK-1300 Scheduling composite.
 *
 * Renders one suggested time: the formatted datetime, voter avatars + count,
 * an optional conflict marker, the `+ Vote` toggle (every viewer), and the
 * operator/creator-gated `Lock this time →` affordance. The row is purely
 * presentational — vote + lock callbacks are owned by the composite so the
 * threshold-confirm modal and reschedule-vs-navigate branch stay in one place.
 */
import type { JSX } from 'react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { MemberAvatarGroup } from '../decided/MemberAvatarGroup';

/** Format a slot's proposed time, flagging past slots. */
function formatSlotTime(proposedTime: string): { label: string; isPast: boolean } {
  const d = new Date(proposedTime);
  const isPast = d <= new Date();
  const label = d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return { label, isPast };
}

export interface SchedulingSlotRowProps {
  slot: ScheduleSlotWithVotesDto;
  /** Viewer has voted on this slot. */
  voted: boolean;
  /** Titles of the viewer's existing events that conflict with this slot (ROK-1032). */
  conflictEventNames: string[];
  /** Interactions disabled (read-only poll). */
  readOnly: boolean;
  /** Operator/creator → render the per-row Lock affordance. */
  canLock: boolean;
  onToggleVote: (slotId: number) => void;
  onLock: (slot: ScheduleSlotWithVotesDto) => void;
}

/** Voter summary: avatars + "N votes". */
function VoteSummary({ slot }: { slot: ScheduleSlotWithVotesDto }): JSX.Element {
  const count = slot.votes.length;
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
    </div>
  );
}

/** Single suggested-time row — see file-level docstring. */
export function SchedulingSlotRow(props: SchedulingSlotRowProps): JSX.Element {
  const {
    slot,
    voted,
    conflictEventNames,
    readOnly,
    canLock,
    onToggleVote,
    onLock,
  } = props;
  const { label, isPast } = formatSlotTime(slot.proposedTime);

  return (
    <div
      data-testid="schedule-slot"
      data-slot-id={slot.id}
      data-voted={voted ? 'true' : 'false'}
      className="flex items-center justify-between gap-3 p-3 rounded-lg border border-edge bg-panel/40"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">
          {label}
          {isPast && <span className="ml-1 text-[11px] text-muted">· past</span>}
          {voted && (
            <span className="ml-1.5 text-emerald-400" aria-label="You voted">
              ✓
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <VoteSummary slot={slot} />
          {conflictEventNames.length > 0 && (
            <span
              className="text-[11px] text-amber-300"
              title={`Conflicts with: ${conflictEventNames.join(', ')}`}
            >
              ⚠ Conflicts with {conflictEventNames[0]}
              {conflictEventNames.length > 1 &&
                ` +${conflictEventNames.length - 1}`}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <button
          type="button"
          aria-pressed={voted}
          aria-label={`${voted ? 'Remove vote for' : 'Vote for'} ${label}`}
          disabled={readOnly}
          onClick={() => onToggleVote(slot.id)}
          className={`min-h-[36px] inline-flex items-center gap-1 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            voted
              ? 'border-emerald-500 bg-emerald-600 text-white'
              : 'border-edge bg-surface text-foreground hover:border-emerald-500/60'
          }`}
        >
          {voted ? '✓ Voted' : '+ Vote'}
        </button>
        {canLock && (
          <button
            type="button"
            aria-label={`Lock this time — ${label}`}
            disabled={readOnly}
            onClick={() => onLock(slot)}
            className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-cyan-500 bg-cyan-600 hover:bg-cyan-500 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            Lock this time →
          </button>
        )}
      </div>
    </div>
  );
}
