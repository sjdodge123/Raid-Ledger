/**
 * Slot list + suggest form for the ROK-1300 Scheduling composite.
 *
 * Renders the sorted suggested-time rows (votes desc, then time asc) and the
 * "Suggest another" form. Extracted so `SchedulingComposite` stays under the
 * 300-line cap.
 */
import type { JSX } from 'react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { SchedulingSlotRow } from './SchedulingSlotRow';
import { SchedulingSuggestForm } from './SchedulingSuggestForm';

export interface SchedulingSlotListProps {
  slots: ScheduleSlotWithVotesDto[];
  myVotedSlotIds: number[];
  conflictingSlotIds: number[];
  readOnly: boolean;
  canLock: boolean;
  isSuggesting: boolean;
  onToggleVote: (slotId: number) => void;
  onLock: (slot: ScheduleSlotWithVotesDto) => void;
  onSuggest: (proposedTime: string) => void;
}

/** Sort slots by votes desc, then proposed time asc. */
function sortSlots(
  slots: ScheduleSlotWithVotesDto[],
): ScheduleSlotWithVotesDto[] {
  return [...slots].sort(
    (a, b) =>
      b.votes.length - a.votes.length ||
      new Date(a.proposedTime).getTime() - new Date(b.proposedTime).getTime(),
  );
}

/** Suggested-time list + suggest form — see file-level docstring. */
export function SchedulingSlotList(props: SchedulingSlotListProps): JSX.Element {
  const voted = new Set(props.myVotedSlotIds);
  const conflicting = new Set(props.conflictingSlotIds);
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
        Suggested Times
      </h2>
      {props.slots.length === 0 && (
        <p className="text-sm text-muted">
          No times suggested yet. Add one below.
        </p>
      )}
      <div className="space-y-2">
        {sortSlots(props.slots).map((slot) => (
          <SchedulingSlotRow
            key={slot.id}
            slot={slot}
            voted={voted.has(slot.id)}
            conflicting={conflicting.has(slot.id)}
            readOnly={props.readOnly}
            canLock={props.canLock}
            onToggleVote={props.onToggleVote}
            onLock={props.onLock}
          />
        ))}
      </div>
      {!props.readOnly && (
        <SchedulingSuggestForm
          isSuggesting={props.isSuggesting}
          onSuggest={props.onSuggest}
        />
      )}
    </section>
  );
}
