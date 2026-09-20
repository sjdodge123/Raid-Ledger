/**
 * Slot ladder for the Scheduling composite (ROK-1300, Layout B in ROK-1543).
 *
 * Renders the sorted suggested-time rows (votes desc, then time asc) as
 * full-width tap targets. The suggest form moved into the "Find a better
 * time" sheet (ROK-1543 AC3) so the poll's primary body is the ranked list
 * of times and nothing else. Ordering comes from `scheduling-leader.ts`, the
 * same helper the leader card uses — one comparator, one winner.
 */
import type { JSX, ReactNode } from 'react';
import { type ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { SchedulingSlotRow } from './SchedulingSlotRow';
import { sortSlots } from './scheduling-leader';

export interface SchedulingSlotListProps {
    slots: ScheduleSlotWithVotesDto[];
    myVotedSlotIds: number[];
    /** ROK-1617: slots the viewer marked as not working for them. */
    myNoSlotIds: number[];
    /** Per-slot conflicting event titles (ROK-1032); slots absent here have no conflict. */
    slotConflicts: { slotId: number; eventTitles: string[] }[];
    readOnly: boolean;
    /** ROK-1545: the viewer may vote at all (terminal poll / private non-member). */
    canVote: boolean;
    /** ROK-1545 (review F4): the viewer has a session (drives the sign-in CTA). */
    signedIn: boolean;
    /** ROK-1545: voting self-enrols the viewer (public lineup, not a member). */
    enrolByVoting: boolean;
    /** Operator/creator — drives whether a row gets a ⋯ menu at all. */
    canLock: boolean;
    /**
     * ROK-1635 (AC3): builds THIS row's organiser menu. Supplied by
     * `SchedulingComposite` (via `useSchedulingTimeMenus`) so every menu on
     * the page shares one rally cooldown; absent in surfaces that render the
     * ladder without organiser actions, e.g. the phone game-time sheet.
     */
    renderSlotMenu?: (slot: ScheduleSlotWithVotesDto) => ReactNode;
    /**
     * Review fix (P2): restrict the lock affordance to ONE row — the slot the
     * server says an expired poll may be finished at. `null` = no restriction
     * (an open poll, where every future row is lockable).
     */
    lockableSlotId: number | null;
    /**
     * ROK-1635 (AC1): the slot the leader card already names. It is dropped
     * from the ladder so the leading time appears exactly once on the page.
     * `null`/absent = nothing leads, so every time is listed (AC2).
     */
    excludeSlotId?: number | null;
    /**
     * ROK-1617 follow-up: slots with a stance press in flight. Their controls
     * render `aria-disabled` — the ladder drops a second press, and a dropped
     * press must be visible rather than silent.
     */
    pendingSlotIds?: number[];
    onToggleVote: (slotId: number) => void;
    /** ROK-1617: press / clear the anti-vote on a slot. */
    onToggleNo: (slotId: number) => void;
    onLock: (slot: ScheduleSlotWithVotesDto) => void;
}

/** Suggested-time ladder — see file-level docstring. */
export function SchedulingSlotList(
    props: SchedulingSlotListProps,
): JSX.Element {
    const voted = new Set(props.myVotedSlotIds);
    const noVoted = new Set(props.myNoSlotIds);
    const pending = new Set(props.pendingSlotIds ?? []);
    const conflictMap = new Map(
        props.slotConflicts.map((c) => [c.slotId, c.eventTitles] as const),
    );
    // ROK-1635: filtered AFTER the sort, so the surviving order is
    // bit-identical to what this ladder rendered before the leader moved out.
    const visible = sortSlots(props.slots).filter(
        (slot) => slot.id !== props.excludeSlotId,
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
            {/* ROK-1635 §4.2: times exist, but the only one is on the card.
                Saying "No times suggested yet" there would read as a bug. */}
            {props.slots.length > 0 && visible.length === 0 && (
                <p
                    data-testid="scheduling-slots-only-leader"
                    className="text-sm text-muted"
                >
                    That’s the only time proposed so far. Use “Find a better
                    time” to add another.
                </p>
            )}
            <div className="space-y-2">
                {visible.map((slot) => (
                    <SchedulingSlotRow
                        key={slot.id}
                        slot={slot}
                        voted={voted.has(slot.id)}
                        noVoted={noVoted.has(slot.id)}
                        conflictEventNames={conflictMap.get(slot.id) ?? []}
                        readOnly={props.readOnly}
                        canVote={props.canVote}
                        signedIn={props.signedIn}
                        enrolByVoting={props.enrolByVoting}
                        menu={props.renderSlotMenu?.(slot)}
                        pending={pending.has(slot.id)}
                        onToggleVote={props.onToggleVote}
                        onToggleNo={props.onToggleNo}
                        onLock={props.onLock}
                    />
                ))}
            </div>
        </section>
    );
}
