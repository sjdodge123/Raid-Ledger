/**
 * JourneyHero toolbar for the ROK-1300 Scheduling composite — sticky on
 * DESKTOP ONLY.
 *
 * ROK-1544: the member submit ritual that used to live here is GONE — a tap
 * on a slot is the whole vote. ROK-1618 then took the last action off this
 * row too: the operator/creator's "Lock this time →" moved into the leader
 * card's "Poll actions ⋯" menu, beside Rally. The game-ref row is now the
 * game-ref alone, at every width.
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
      {/* ROK-1618: the game-ref is alone on this row now. The operator lock
          that used to sit at its right end (and stacked into a full-width bar
          floating above the leader card on a phone) moved INTO that card's
          "Poll actions ⋯" menu — one home for ending a poll. */}
      <div className="mt-2 px-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SchedulingGameRefBanner match={match} mode={mode} />
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
