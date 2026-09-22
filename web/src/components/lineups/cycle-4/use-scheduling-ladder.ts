/**
 * The scheduling ballot's binding, as one hook (ROK-1574).
 *
 * `SchedulingComposite` used to build the `SchedulingSlotList` props inline.
 * ROK-1574 puts the SAME ladder on step 2 of the phone game-time sheet, and a
 * second binding would be a second set of gates to keep in sync — so the
 * binding moved here. The composite calls it once and spreads the result into
 * both places; the sheet receives the object, never the hooks.
 *
 * Behaviour is unchanged from the composite: one tap casts or withdraws the
 * vote (approval voting), a second tap on a slot whose toggle is still in
 * flight is ignored (two overlapping toggles snapshot each other's optimistic
 * state), and the live region is announced on SUCCESS only.
 */
import { useMemo, useState } from 'react';
import type {
    SchedulePollPageResponseDto,
    ScheduleSlotWithVotesDto,
    ScheduleVoteStance,
} from '@raid-ledger/contract';
import { useToggleScheduleVote, type SchedulingVoter } from '../../../hooks/use-scheduling';
import { useAuth } from '../../../hooks/use-auth';
import { canBypassThreshold } from '../../../pages/scheduling/threshold';
import { formatSlotTime } from './scheduling-slot-time';
import { useVoteSource } from './use-vote-source';
import type { SchedulingSlotListProps } from './SchedulingSlotList';

export interface UseSchedulingLadderArgs {
    poll: SchedulePollPageResponseDto;
    lineupId: number;
    matchId: number;
    /** The poll is not open — rows render without vote affordances. */
    readOnly: boolean;
    /** The viewer's user id, or `null` when signed out. */
    me: number | null;
    /** The composite's lock controller (`useSchedulingLock`). */
    lock: { requestLock: (slot: ScheduleSlotWithVotesDto) => void };
    /** The composite's polite live region (`useSchedulingAnnouncer`). */
    announcer: {
        announceVote: (label: string, stance: ScheduleVoteStance | null) => void;
    };
}

/**
 * The viewer as a slot voter, so the toggle can move the leader card and the
 * row counts on the tap instead of on the refetch. Undefined until they are a
 * poll member — an open-roster first-timer is enrolled by the vote itself.
 */
function useViewer(
    poll: SchedulePollPageResponseDto,
    me: number | null,
): SchedulingVoter | undefined {
    return useMemo(() => {
        const member = poll.match.members.find((m) => m.userId === me);
        if (!member) return undefined;
        return {
            userId: member.userId,
            displayName: member.displayName,
            avatar: member.avatar,
            discordId: member.discordId,
            customAvatarUrl: member.customAvatarUrl,
        };
    }, [poll.match.members, me]);
}

/** The set of slots with a toggle in flight, plus its drop helper. */
function usePendingSlots(): {
    pending: ReadonlySet<number>;
    add: (slotId: number) => void;
    clear: (slotId: number) => void;
} {
    const [pending, setPending] = useState<ReadonlySet<number>>(() => new Set());
    return {
        pending,
        add: (slotId) => setPending((prev) => new Set(prev).add(slotId)),
        clear: (slotId) =>
            setPending((prev) => {
                const next = new Set(prev);
                next.delete(slotId);
                return next;
            }),
    };
}

/**
 * The ballot binding: every `SchedulingSlotList` prop, PLUS the two values the
 * composite reads back off it rather than deriving a second time.
 *
 * ROK-1635 review: they are deliberately NOT on `SchedulingSlotListProps`. The
 * ladder renders no lock of its own any more — the gate and the callback both
 * belong to the ⋯ menus (`useSchedulingTimeMenus`) — and a `canLock` the list
 * documented as "drives whether a row gets a ⋯ menu" while reading it nowhere
 * would tell the next caller something false.
 */
export interface SchedulingLadderBinding extends SchedulingSlotListProps {
    /** Operator/creator gate for the ⋯ menus (`canManage`). */
    canLock: boolean;
    /** Ask for the lock-in confirm modal on a slot. */
    onLock: (slot: ScheduleSlotWithVotesDto) => void;
}

/**
 * Build the complete ballot binding for a poll — see the file-level docstring.
 * The returned object is the ONLY thing a ballot surface needs; `canVote` /
 * `canLock` are read back off it by the composite so the gates are derived in
 * exactly one place.
 */
export function useSchedulingLadder(args: UseSchedulingLadderArgs): SchedulingLadderBinding {
    const { poll, lineupId, matchId, readOnly, me, lock, announcer } = args;
    const { user } = useAuth();
    const toggleVote = useToggleScheduleVote();
    const viewer = useViewer(poll, me);
    const slotPending = usePendingSlots();
    // ROK-1550: captured once for the visit, so a vote cast after the page
    // rewrites its own query string is still attributed to the poll card.
    const source = useVoteSource();

    const canVote = poll.canVote;
    const isMember = poll.match.members.some((m) => m.userId === me);

    /**
     * Read the slot's own label out of the payload for the live region.
     *
     * ROK-1617: the STANCE the server landed on drives the message, never the
     * `voted` flag — `voted` means "holds a YES", so a successful NO comes
     * back false and was announced as a withdrawn vote.
     */
    const announceVoteFor = (
        slotId: number,
        stance: ScheduleVoteStance | null,
    ): void => {
        const slot = poll.slots.find((s) => s.id === slotId);
        if (slot) announcer.announceVote(formatSlotTime(slot.proposedTime).label, stance);
    };

    /**
     * Press one answer on a slot (ROK-1617). Both affordances share the same
     * in-flight guard and the same live-region announcement, so a `no` cannot
     * race a `yes` into the cache — two overlapping toggles would snapshot
     * each other's optimistic state.
     *
     * ROK-1617 follow-up: the guard is per SLOT but `useToggleScheduleVote` is
     * ONE observer, and `mutate()` detaches the observer from the mutation it
     * was already running (`mutationObserver.js:56-57`). So a press on ANOTHER
     * slot mid-flight orphaned the first press's MUTATE-level callbacks: its
     * slot stayed in the pending set forever and every later press on it was
     * dropped here silently — no request, no toast, the operator's "undoing an
     * anti vote doesn't recalculate the lead time". The lifetime of the
     * pending entry (and of the announcement) must therefore hang off the
     * mutation's own promise, which settles whatever the observer is doing;
     * the mutation-level `onError` in `useToggleScheduleVote` still owns the
     * rollback and the toast, so the rejection is swallowed here.
     */
    const pressStance = (slotId: number, stance: ScheduleVoteStance): void => {
        if (!canVote || slotPending.pending.has(slotId)) return;
        slotPending.add(slotId);
        void toggleVote
            .mutateAsync({ lineupId, matchId, slotId, viewer, stance, source })
            .then((data) => announceVoteFor(slotId, data.stance ?? null))
            .catch(() => undefined)
            .finally(() => slotPending.clear(slotId));
    };

    const onToggleVote = (slotId: number): void => pressStance(slotId, 'yes');
    const onToggleNo = (slotId: number): void => pressStance(slotId, 'no');

    return {
        slots: poll.slots,
        myVotedSlotIds: poll.myVotedSlotIds,
        myNoSlotIds: poll.myNoSlotIds ?? [],
        slotConflicts: poll.slotConflicts ?? [],
        readOnly,
        canVote,
        signedIn: me !== null,
        enrolByVoting: canVote && !isMember,
        // ROK-1610: a terminal poll shows the per-row lock ONLY when the
        // viewer may finish it after expiry — a cancelled or locked-in poll,
        // and a member looking at an expired one, get no lock button at all
        // (it used to render disabled, which read as "try again later").
        canLock:
            canBypassThreshold(user, poll.match) &&
            (!readOnly || poll.canLockIn === true),
        // ROK-1635: the expired-poll "only this slot may be locked" rule used
        // to ride along here, but the ladder's rows now carry no lock of their
        // own (it lives in `SchedulingTimeMenu`, which renders nothing on a
        // read-only poll) — `poll.lockInSlotId` reaches the one surface that
        // still offers it through `use-expired-lock-in.ts` instead.
        // ROK-1617 follow-up: the guard is no longer private to the hook —
        // every surface bound to this ladder disables the slot it is already
        // toggling, so a dropped press is visible instead of silent.
        pendingSlotIds: [...slotPending.pending],
        onToggleVote,
        onToggleNo,
        onLock: lock.requestLock,
    };
}
