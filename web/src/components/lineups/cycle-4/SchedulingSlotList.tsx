/**
 * Slot ladder for the Scheduling composite (ROK-1300, Layout B in ROK-1543).
 *
 * Renders the sorted suggested-time rows (votes desc, then time asc) as
 * full-width tap targets. The suggest form moved into the "Find a better
 * time" sheet (ROK-1543 AC3) so the poll's primary body is the ranked list
 * of times and nothing else. Ordering comes from `scheduling-leader.ts`, the
 * same helper the leader card uses — one comparator, one winner.
 */
import type { JSX } from 'react';
import { type ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { SchedulingSlotRow } from './SchedulingSlotRow';
import { sortSlots } from './scheduling-leader';

export interface SchedulingSlotListProps {
    slots: ScheduleSlotWithVotesDto[];
    myVotedSlotIds: number[];
    /** Per-slot conflicting event titles (ROK-1032); slots absent here have no conflict. */
    slotConflicts: { slotId: number; eventTitles: string[] }[];
    readOnly: boolean;
    /** ROK-1545: the viewer may vote at all (terminal poll / private non-member). */
    canVote: boolean;
    /** ROK-1545 (review F4): the viewer has a session (drives the sign-in CTA). */
    signedIn: boolean;
    /** ROK-1545: voting self-enrols the viewer (public lineup, not a member). */
    enrolByVoting: boolean;
    canLock: boolean;
    /**
     * Review fix (P2): restrict the lock affordance to ONE row — the slot the
     * server says an expired poll may be finished at. `null` = no restriction
     * (an open poll, where every future row is lockable).
     */
    lockableSlotId: number | null;
    onToggleVote: (slotId: number) => void;
    onLock: (slot: ScheduleSlotWithVotesDto) => void;
}

/** Suggested-time ladder — see file-level docstring. */
export function SchedulingSlotList(
    props: SchedulingSlotListProps,
): JSX.Element {
    const voted = new Set(props.myVotedSlotIds);
    const conflictMap = new Map(
        props.slotConflicts.map((c) => [c.slotId, c.eventTitles] as const),
    );
    return (
        <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Suggested Times
            </h2>
            {props.slots.length === 0 && (
                <p className="text-sm text-muted">
                    No times suggested yet. Use “Find a better time” to add one.
                </p>
            )}
            <div className="space-y-2">
                {sortSlots(props.slots).map((slot) => (
                    <SchedulingSlotRow
                        key={slot.id}
                        slot={slot}
                        voted={voted.has(slot.id)}
                        conflictEventNames={conflictMap.get(slot.id) ?? []}
                        readOnly={props.readOnly}
                        canVote={props.canVote}
                        signedIn={props.signedIn}
                        enrolByVoting={props.enrolByVoting}
                        canLock={
                            props.canLock &&
                            (props.lockableSlotId === null ||
                                props.lockableSlotId === slot.id)
                        }
                        onToggleVote={props.onToggleVote}
                        onLock={props.onLock}
                    />
                ))}
            </div>
        </section>
    );
}
