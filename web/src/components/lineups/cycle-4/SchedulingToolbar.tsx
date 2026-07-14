/**
 * Sticky JourneyHero toolbar for the ROK-1300 Scheduling composite.
 *
 * The submit ritual lives HERE — inside the sticky, scroll-aware toolbar —
 * NOT in a bottom `<SubmitBar>` (matches shipped Sv/S1). Rework round 2: the
 * U2 game-ref is merged INTO this card, on the SAME row as the submit button
 * (game-ref left, submit right; stacked on mobile). Operator `Cancel Poll`
 * sits at the card's top-right. The sentinel + auto-hide transform are owned
 * by `useSchedulingSticky`.
 */
import type { JSX } from 'react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { JourneyHero } from '../../shared/journey-hero';
import { LineupParticipantsButton } from '../LineupParticipantsButton';
import type { JourneyHeroProps } from '../../shared/journey-hero/types';
import { StickyHeroScheduleSubmitButton } from './sticky-hero-buttons';
import { useSchedulingSticky } from './use-scheduling-sticky';
import { SchedulingGameRefBanner } from './SchedulingGameRefBanner';
import { SchedulingCancelAction } from './SchedulingCancelAction';
import { SchedulingRemindAction } from './SchedulingRemindAction';
import { SchedulingVoteProgress } from './SchedulingVoteProgress';
import type { SchedulingMode } from './scheduling-submit-copy';

export interface SchedulingToolbarProps {
  hero: JourneyHeroProps;
  match: MatchDetailResponseDto;
  mode: SchedulingMode;
  lineupId: number;
  matchId: number;
  readOnly: boolean;
  /** Distinct voters so far (poll.uniqueVoterCount) — drives the progress bar. */
  uniqueVoterCount: number | undefined;
  submitLabel: string;
  submitted: boolean;
  submitDisabled: boolean;
  submitDisabledReason?: string;
  nudge?: string;
  onSubmit: () => void;
}

/** Sticky toolbar: hero + Cancel + game-ref/submit row + progress — see docstring. */
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
            <div className="flex items-center gap-1.5">
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
        {/* Game-ref (left) + submit (right) on one row; stacks on mobile. */}
        <div className="mt-2 px-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SchedulingGameRefBanner match={match} mode={mode} />
          <div className="sm:flex-shrink-0">
            <StickyHeroScheduleSubmitButton
              label={props.submitLabel}
              submitted={props.submitted}
              disabled={props.submitDisabled}
              disabledReason={props.submitDisabledReason}
              onClick={props.onSubmit}
            />
          </div>
        </div>
        {/* Compact vote-progress bar (ROK-1015/1121) — only when a threshold
            is set. Sits under the game-ref/submit row. */}
        <SchedulingVoteProgress
          match={match}
          uniqueVoterCount={props.uniqueVoterCount}
        />
        {props.nudge && (
          <p className="mt-1 px-1 text-[11px] text-muted italic">
            {props.nudge}
          </p>
        )}
      </div>
    </>
  );
}
