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
import type { JSX } from 'react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { PollDeadlineBanner } from '../../../pages/scheduling/PollDeadlineBanner';
import { MemberAvatarGroup } from '../decided/MemberAvatarGroup';
import { deriveSchedulingLeader, type SchedulingLeader } from './scheduling-leader';
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
function LeaderVoters({ slot }: { slot: ScheduleSlotWithVotesDto }): JSX.Element | null {
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
          <span data-testid="scheduling-leader-tie" className="text-amber-400">
            {' · tied — earliest time wins'}
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
      </div>
    </>
  );
}

/** Promoted leading-slot card — see file-level docstring. */
export function SchedulingLeaderCard(
  props: SchedulingLeaderCardProps,
): JSX.Element {
  const { slots, memberCount, phaseDeadline, readOnly } = props;
  const leader = deriveSchedulingLeader(slots);
  return (
    <CardShell tinted={leader !== null && leader.votes > 0}>
      {leader === null ? (
        <>
          <p className="text-sm font-medium text-foreground">
            No times proposed yet.
          </p>
          <p className="text-xs text-secondary">
            Open “Find a better time” below and put the first one up.
          </p>
        </>
      ) : (
        <LeaderBody
          leader={leader}
          memberCount={memberCount}
          readOnly={readOnly}
        />
      )}
      <PollDeadlineBanner phaseDeadline={phaseDeadline} />
    </CardShell>
  );
}
