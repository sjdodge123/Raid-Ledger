/**
 * Layout-B leader card for the scheduling poll (ROK-1543 / ROK-1540 P1-1).
 *
 * The poll's job is "when ARE we playing", so the winning slot is promoted
 * out of the list into a decision card that sits directly below the kept
 * poll header (JourneyHero + toolbar + game-ref row — untouched) and above
 * the ladder. It answers, in one glance and without scrolling on 375px:
 * which time is leading, how many of the members picked it, whether the top
 * two are level (and what breaks that tie), and when the poll closes.
 *
 * The deadline is the shipped `PollDeadlineBanner` rendered INSIDE the card
 * rather than a second copy of the same clock — one source of truth, and
 * `poll-deadline-banner` keeps resolving for the existing smoke specs.
 */
import type { JSX, ReactNode } from 'react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { SLOT_TIE_RULE } from '@raid-ledger/contract';
import { PollDeadlineBanner } from '../../../pages/scheduling/PollDeadlineBanner';
import { MemberAvatarGroup } from '../decided/MemberAvatarGroup';
import {
    resolveCardLeader,
    type SchedulingLeader,
} from './scheduling-leader';
import { formatSlotTime } from './scheduling-slot-time';

export interface SchedulingLeaderCardProps {
    /** Every proposed slot, unsorted — the card derives the leader itself. */
    slots: ScheduleSlotWithVotesDto[];
    /** Total poll members (denominator of the "N of M" line). */
    memberCount: number;
    /** Poll deadline (ISO) or null/undefined when none is configured. */
    phaseDeadline: string | null | undefined;
    /** The poll no longer accepts votes. */
    readOnly: boolean;
    /**
     * ROK-1617 follow-up: the ISO time a lock-in selected, when the poll has
     * one. It OVERRIDES the ranking — lock-in ignores the leader floor
     * (ruling D-Q3), so the card must name the time that was actually
     * scheduled rather than "No time works for the group yet."
     */
    lockedInTime?: string | null;
    /**
     * ROK-1635 (AC1): the leading time, derived ONCE for the whole surface by
     * `useSchedulingCardLeader` so the row the ladder hides is, by
     * construction, the row this card names. Omit it (`undefined`) and the
     * card falls back to deriving its own — which is what keeps this card's
     * own specs, and any other caller, working unchanged.
     */
    leader?: SchedulingLeader | null;
    /**
     * ROK-1618: the organiser's "Poll actions ⋯" menu, drawn at the card's
     * top-right. The lock that ends the poll used to float above this card in
     * the toolbar; it belongs on the card that names the time it locks.
     * Omitted (or `null`) for a viewer who cannot end the poll.
     */
    menu?: ReactNode;
    /**
     * ROK-1617 follow-up (item B): the viewer's ballot for the LEADING time —
     * `+ Vote` / `Doesn’t work`, injected the same way `menu` is so the card
     * stays presentational. Rendered only when a time actually leads: the
     * "No time works for the group yet." state offers nothing to vote on.
     */
    voteControls?: ReactNode;
}

/** Status label: "Leading" / "Finished ahead" / "No votes yet". */
function statusLabel(leader: SchedulingLeader, readOnly: boolean): string {
    if (leader.votes === 0) return 'No votes yet';
    return readOnly ? 'Finished ahead' : 'Leading';
}

/** Card shell — tinted when there is a leader, neutral when the poll is empty. */
function CardShell({
    tinted,
    children,
}: {
    tinted: boolean;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <div
            data-testid="scheduling-leader-card"
            className={`space-y-2 rounded-lg border p-3 ${
                tinted
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : 'border-edge bg-panel/40'
            }`}
        >
            {children}
        </div>
    );
}

/** Voters who picked the leading slot, as avatars. */
function LeaderVoters({
    slot,
}: {
    slot: ScheduleSlotWithVotesDto;
}): JSX.Element | null {
    if (slot.votes.length === 0) return null;
    return (
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
    );
}

/** The leading time + its vote/member line. */
function LeaderBody(props: {
    leader: SchedulingLeader;
    memberCount: number;
    readOnly: boolean;
}): JSX.Element {
    const { leader, memberCount, readOnly } = props;
    const { label, isPast } = formatSlotTime(leader.slot.proposedTime);
    return (
        <>
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-400">
                <span data-testid="scheduling-leader-status">
                    {statusLabel(leader, readOnly)}
                </span>
                {leader.tied && (
                    <span
                        data-testid="scheduling-leader-tie"
                        className="text-amber-400"
                    >
                        {` · ${SLOT_TIE_RULE}`}
                    </span>
                )}
            </p>
            <p
                data-testid="scheduling-leader-time"
                className="text-lg font-semibold text-foreground"
            >
                {label}
            </p>
            {/*
        ROK-1543: the ladder row flags a past slot, so the card must too — an
        all-past open poll otherwise reads "Leading — <a time that has already
        been and gone>" as if it were still actionable. Which slot leads is
        unchanged (terminal/expired semantics are ROK-1545).
      */}
            {isPast && (
                <p
                    data-testid="scheduling-leader-past"
                    className="text-xs text-amber-400"
                >
                    This time has already passed.
                </p>
            )}
            <div className="flex items-center gap-2">
                <LeaderVoters slot={leader.slot} />
                <span
                    data-testid="scheduling-leader-votes"
                    className="text-xs text-secondary"
                >
                    {leader.votes} of {memberCount}{' '}
                    {memberCount === 1 ? 'member' : 'members'} picked this time
                </span>
                {/*
                    ROK-1617 (AC6): "3 of 4 picked" on a 3-yes/1-no poll reads
                    as "the fourth has not answered". The anti-vote tally uses
                    the SAME clause the slot rows use (`VoteSummary` in
                    `SchedulingSlotRow`) so one poll does not word the same
                    fact two ways.
                */}
                {leader.noVotes > 0 && (
                    <span
                        data-testid="scheduling-leader-no-count"
                        className="text-xs text-dim"
                    >{`· ${leader.noVotes} can’t`}</span>
                )}
            </div>
        </>
    );
}

/**
 * The card with no leading time.
 *
 * Two distinct situations (ROK-1617 item D): nothing has been proposed, or
 * times exist but none clears the shared leader floor — "No time worked", the
 * operator's words. Naming the second as the first would read as a bug.
 */
function NoLeaderBody({ hasSlots }: { hasSlots: boolean }): JSX.Element {
    return (
        <>
            <p className="text-sm font-medium text-foreground">
                {hasSlots
                    ? 'No time works for the group yet.'
                    : 'No times proposed yet.'}
            </p>
            <p className="text-xs text-secondary">
                {hasSlots
                    ? 'Open “Find a better time” below and suggest one that does.'
                    : 'Open “Find a better time” below and put the first one up.'}
            </p>
        </>
    );
}

/** The card's left column: the leader, or the reason there isn't one. */
function CardBody(props: {
    leader: SchedulingLeader | null;
    slotCount: number;
    memberCount: number;
    readOnly: boolean;
}): JSX.Element {
    const { leader, slotCount, memberCount, readOnly } = props;
    if (leader === null) return <NoLeaderBody hasSlots={slotCount > 0} />;
    return (
        <LeaderBody
            leader={leader}
            memberCount={memberCount}
            readOnly={readOnly}
        />
    );
}

/** Promoted leading-slot card — see file-level docstring. */
export function SchedulingLeaderCard(
    props: SchedulingLeaderCardProps,
): JSX.Element {
    const { slots, memberCount, phaseDeadline, readOnly, menu, voteControls } =
        props;
    // ROK-1635: the hoisted leader wins when the composite hands one down.
    // `props` is a superset of the resolver's input — no re-listing to drift.
    const leader =
        props.leader !== undefined ? props.leader : resolveCardLeader(props);
    return (
        <CardShell tinted={leader !== null && leader.votes > 0}>
            {/* ROK-1618: status/time/voters on the left, the ⋯ menu pinned
                top-right. The deadline banner stays full width below. */}
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                    <CardBody
                        leader={leader}
                        slotCount={slots.length}
                        memberCount={memberCount}
                        readOnly={readOnly}
                    />
                </div>
                {menu}
            </div>
            <PollDeadlineBanner phaseDeadline={phaseDeadline} />
            {/* ROK-1617 follow-up: the ballot for the leading time, LAST in
                the card so the deadline banner's position is unchanged by
                construction (`scheduling-poll.smoke.spec.ts` pins its bottom
                edge inside a 375×667 fold). Rendered unconditionally: the
                control decides for itself whether there is anything to answer
                — it must survive an optimistic write that drops the leader,
                because the press that caused it is still in flight. */}
            {voteControls}
        </CardShell>
    );
}
