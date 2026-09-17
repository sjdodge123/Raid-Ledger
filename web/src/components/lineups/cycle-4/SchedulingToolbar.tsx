/**
 * JourneyHero toolbar for the ROK-1300 Scheduling composite — sticky on
 * DESKTOP ONLY.
 *
 * ROK-1544: the member submit ritual that used to live here is GONE — a tap
 * on a slot is the whole vote. The game-ref row keeps its right-hand slot for
 * the ONE action that still ends a poll: the operator/creator's
 * "Lock this time →" on the leading slot. Plain members get the game-ref
 * alone. Operator `Cancel Poll` sits at the card's top-right.
 *
 * ROK-1558: the hero used to be `sticky top-14` at every width and auto-hide
 * on mobile scroll-down (`useSchedulingSticky`, since deleted) by translating
 * itself off-screen. A transform does not collapse the sticky box, so the
 * hidden hero left a blank band its own height tall above the slot ladder on
 * a phone. Now it pins from `md` up only; on mobile it simply scrolls away
 * with the page. Nothing is lost: since ROK-1545 lock-in is per-row, no
 * action in this toolbar has to stay reachable while scrolling the ladder.
 */
import type { JSX } from 'react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { JourneyHero } from '../../shared/journey-hero';
import { LineupParticipantsButton } from '../LineupParticipantsButton';
import type { JourneyHeroProps } from '../../shared/journey-hero/types';
import { StickyHeroLockPollButton } from './sticky-hero-buttons';
import { SchedulingGameRefBanner } from './SchedulingGameRefBanner';
import { SchedulingVoteProgress } from './SchedulingVoteProgress';
import type { SchedulingMode } from './scheduling-hero';
import { SchedulingManageButton } from './SchedulingManageSheet';
import { SchedulingManageDropdown } from './SchedulingManageDropdown';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';

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

/** Toolbar (desktop-sticky): hero + Manage poll + game-ref/lock row + progress. */
export function SchedulingToolbar(props: SchedulingToolbarProps): JSX.Element {
  const { hero, match, mode, lineupId, matchId, readOnly } = props;
  // ROK-1584/1585: below the phone breakpoint the creator actions live in the
  // "Manage poll ⋯" sheet, from it up in the dropdown. That breakpoint is
  // 1024px (DESKTOP_MQ) so tablets get the phone treatment too — the `lg:`
  // prefixes on the sticky wrapper below are the CSS half of the same switch.
  const isDesktop = useMediaQuery(DESKTOP_MQ);
  const manageProps = { lineupId, matchId, match, readOnly, uniqueVoterCount: props.uniqueVoterCount };
  return (
    <div
      data-testid="scheduling-toolbar"
      className="lg:sticky lg:top-14 z-20 py-3 bg-backdrop lg:bg-surface lg:rounded-md lg:px-3"
    >
      {/* ROK-1585: the creator/operator actions are ONE "Manage poll ⋯"
          control at every width — the hero's `manage` row + bottom sheet
          below the breakpoint, the control cluster's dropdown from it up. */}
      <JourneyHero
        {...hero}
        action={
          /* ROK-1557: the roster used to be faked client-side from
             `match.members` (everyone hardcoded invitee/waiting). The server
             answers the poll when handed the matchId, so the chips are real. */
          <LineupParticipantsButton lineupId={lineupId} matchId={matchId} size="touch" />
        }
        manage={
          isDesktop ? undefined : (
            <SchedulingManageButton {...manageProps} />
          )
        }
        headerAction={
          !isDesktop ? undefined : (
            <SchedulingManageDropdown {...manageProps} />
          )
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
  );
}
