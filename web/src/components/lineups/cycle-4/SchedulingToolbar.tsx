/**
 * Sticky JourneyHero toolbar for the ROK-1300 Scheduling composite.
 *
 * ROK-1544: the member submit ritual that used to live here is GONE — a tap
 * on a slot is the whole vote. The game-ref row keeps its right-hand slot for
 * the ONE action that still ends a poll: the operator/creator's
 * "Lock this time →" on the leading slot. Plain members get the game-ref
 * alone. Operator `Cancel Poll` sits at the card's top-right. The sentinel +
 * auto-hide transform are owned by `useSchedulingSticky`.
 */
import type { JSX } from 'react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { JourneyHero } from '../../shared/journey-hero';
import { LineupParticipantsButton } from '../LineupParticipantsButton';
import type { JourneyHeroProps } from '../../shared/journey-hero/types';
import { StickyHeroLockPollButton } from './sticky-hero-buttons';
import { useSchedulingSticky } from './use-scheduling-sticky';
import { SchedulingGameRefBanner } from './SchedulingGameRefBanner';
import { SchedulingCancelAction } from './SchedulingCancelAction';
import { SchedulingRemindAction } from './SchedulingRemindAction';
import { SchedulingAddMembersAction } from './SchedulingAddMembersAction';
import { SchedulingVoteProgress } from './SchedulingVoteProgress';
import type { SchedulingMode } from './scheduling-hero';

export interface SchedulingToolbarProps {
  hero: JourneyHeroProps;
  match: MatchDetailResponseDto;
  mode: SchedulingMode;
  lineupId: number;
  matchId: number;
  readOnly: boolean;
  /** Distinct voters so far (poll.uniqueVoterCount) — drives the progress bar. */
  uniqueVoterCount: number | undefined;
  /** Viewer may end the poll (operator/creator) AND a leading slot exists. */
  canLock: boolean;
  /** Human-readable leading time for the lock button's accessible name. */
  leadingTimeLabel: string;
  /** End the poll on the leading slot. */
  onLockLeader: () => void;
}

/** Sticky toolbar: hero + Cancel + game-ref/lock row + progress — see docstring. */
export function SchedulingToolbar(props: SchedulingToolbarProps): JSX.Element {
  const { hero, match, mode, lineupId, matchId, readOnly } = props;
  const { sentinelRef, isHidden } = useSchedulingSticky();
  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      <div
        className={`sticky top-14 z-20 py-3 bg-backdrop md:bg-surface md:rounded-md md:px-3 will-change-transform md:will-change-auto md:translate-y-0 ${
          isHidden ? '-translate-y-[calc(100%+3.5rem)]' : 'translate-y-0'
        }`}
        style={{ transition: 'transform 300ms ease-in-out' }}
      >
        {/* Cancel rides the badge row (below the ribbon) via headerAction so it
            never collides with the rightmost "Schedule" ribbon node (round 3). */}
        <JourneyHero
          {...hero}
          action={
            <LineupParticipantsButton
              lineupId={lineupId}
              participantsOverride={match.members.map((m) => ({
                userId: m.userId,
                displayName: m.displayName,
                avatar: m.avatar,
                customAvatarUrl: m.customAvatarUrl,
                discordId: m.discordId,
                role: 'invitee' as const,
                status: 'waiting' as const,
                steamLinked: false,
              }))}
            />
          }
          headerAction={
            /* Stacks on mobile so the three actions never widen the hero's
               badge-row cluster (participants + done-pill + these actions)
               past a 375px viewport. ROK-1500: the badge row itself now wraps
               (JourneyHero HeroHeader), so the cluster drops onto its own
               line inside the card instead of hanging past its edge. */
            <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center">
              <SchedulingAddMembersAction
                lineupId={lineupId}
                matchId={matchId}
                match={match}
                readOnly={readOnly}
              />
              <SchedulingRemindAction
                lineupId={lineupId}
                matchId={matchId}
                match={match}
                readOnly={readOnly}
              />
              <SchedulingCancelAction
                lineupId={lineupId}
                matchId={matchId}
                readOnly={readOnly}
              />
            </div>
          }
        />
        {/* Game-ref (left) + operator lock (right) on one row; stacks on mobile. */}
        <div className="mt-2 px-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SchedulingGameRefBanner match={match} mode={mode} />
          {props.canLock && (
            <div className="sm:flex-shrink-0">
              <StickyHeroLockPollButton
                timeLabel={props.leadingTimeLabel}
                disabled={readOnly}
                onClick={props.onLockLeader}
              />
            </div>
          )}
        </div>
        {/* Compact vote-progress bar (ROK-1015/1121) — only when a threshold
            is set. Sits under the game-ref/submit row. */}
        <SchedulingVoteProgress
          match={match}
          uniqueVoterCount={props.uniqueVoterCount}
        />
      </div>
    </>
  );
}
