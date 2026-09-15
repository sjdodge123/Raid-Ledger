/**
 * Sx/Ss Scheduling composite (ROK-1300) — the FULL page body for the
 * scheduling phase of a lineup poll. ONE component, TWO modes driven by
 * `poll.isStandalone`:
 *   - from-match (Ss, false): 4-phase ribbon JourneyHero + "Match N of M" +
 *     "Next: <game>" cross-refs.
 *   - standalone (Sx, true): noRibbon hero, "🗓 Scheduling Poll · started by
 *     <creator | you>" (ROK-1496: names the actual creator), no cross-match refs.
 *
 * Owns the page body per the Sx/Ss wireframe. The hero card (ROK-1558:
 * pinned on desktop, scrolls away with the page on mobile) hosts, on
 * ONE row, the clickable U2 game-ref (left, → /games/:id) and — ROK-1544, for
 * operators/creators only — "Lock this time →" on the leading slot (right);
 * operator Cancel sits at the card's top-right — all inside
 * `SchedulingToolbar`. ROK-1543 (Layout B) reshapes what sits
 * BELOW that kept header: read-only banner, the promoted leader card (which
 * carries the deadline), the ranked slot ladder, then ONE "Find a better
 * time" affordance that opens the group-availability heatmap + suggest form
 * in a BottomSheet (<768px) / Modal (>=768px). Replaces
 * the legacy HeroNextStep/useLineupHero hero, the SchedulingWizard stepper, and
 * the 345-line CreateEventSection.
 *
 * ROK-1544 retires the member Submit entirely: tapping a slot casts or
 * withdraws the vote and IS the complete action (approval voting — any number
 * of slots), the server stamps `schedulingSubmittedAt` from the first vote,
 * and "Lock this time →" survives only as the operator/creator's end-the-poll
 * action (per row, and once in the toolbar on the leading slot). Nominating
 * and Voting keep their SubmitBar — they spend a budget, so "I'm finished" is
 * real information there.
 */
import { useMemo, useState, type JSX } from 'react';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { useSuggestSlot } from '../../../hooks/use-scheduling';
import { useLineupMatches } from '../../../hooks/use-lineup-matches';
import { useAuth } from '../../../hooks/use-auth';
import { EarlyCreateConfirmModal } from '../../../pages/scheduling/EarlyCreateConfirmModal';
import {
  buildSchedulingHero,
  resolvePollCreator,
  schedulingModeFor,
} from './scheduling-hero';
import { deriveCrossRefs } from './scheduling-crossrefs';
import { useSchedulingLock } from './use-scheduling-lock';
import { useSchedulingLadder } from './use-scheduling-ladder';
import { SchedulingToolbar } from './SchedulingToolbar';
import { SchedulingAvailability } from './SchedulingAvailability';
import { SchedulingSlotList } from './SchedulingSlotList';
import { useSchedulingGameTimeCheck } from './SchedulingGameTimeCheck';
import { SchedulingLeaderCard } from './SchedulingLeaderCard';
import { deriveSchedulingLeader } from './scheduling-leader';
import { formatSlotTime } from './scheduling-slot-time';
import { useSchedulingAnnouncer } from './use-scheduling-announcer';
import { SchedulingAnnouncer } from './SchedulingAnnouncer';
import { SchedulingSuggestForm } from './SchedulingSuggestForm';
import {
  SchedulingBetterTimeSheet,
  SchedulingBetterTimeTrigger,
} from './SchedulingBetterTimeSheet';
import {
  SchedulingTerminalBanner,
  type SchedulingPollStatus,
} from './SchedulingTerminalBanner';
import { SchedulingCatchUpLine } from './SchedulingCatchUpLine';
import { SchedulingPendingVoters } from './SchedulingPendingVoters';
import { deriveCatchUp, formatDeadlineLabel } from './scheduling-catch-up';

export interface SchedulingCompositeProps {
  poll: SchedulePollPageResponseDto;
  lineupId: number;
  matchId: number;
}

/**
 * The poll's lifecycle (ROK-1545). The server derives `pollStatus` with the
 * same helper the Discord embed uses, so page and embed can never disagree;
 * the match-status fallback only covers a payload cached before that field
 * existed, and collapses every ending to "expired" — which is exactly what
 * the old single banner said.
 */
function resolvePollStatus(
  poll: SchedulePollPageResponseDto,
): SchedulingPollStatus {
  if (poll.pollStatus) return poll.pollStatus;
  const open =
    poll.match.status === 'scheduling' || poll.match.status === 'suggested';
  return open ? 'open' : 'closed';
}

/** Sx/Ss Scheduling composite — see file-level docstring. */
export function SchedulingComposite(
  props: SchedulingCompositeProps,
): JSX.Element {
  const { poll, lineupId, matchId } = props;
  const { user } = useAuth();
  const me = user?.id ?? null;
  const mode = schedulingModeFor(poll.isStandalone);
  const pollStatus = resolvePollStatus(poll);
  const readOnly = pollStatus !== 'open';
  const suggest = useSuggestSlot();
  const { data: matches } = useLineupMatches(
    poll.isStandalone ? undefined : lineupId,
  );
  const lock = useSchedulingLock(poll.match, matchId);
  const [prefillTime, setPrefillTime] = useState<string | undefined>();
  const [betterTimeOpen, setBetterTimeOpen] = useState(false);

  const mySubmittedAt = useMemo(
    () =>
      poll.match.members.find((m) => m.userId === me)?.schedulingSubmittedAt ??
      null,
    [poll.match.members, me],
  );

  const crossRefs = poll.isStandalone ? null : deriveCrossRefs(matchId, matches);
  const hero = buildSchedulingHero({
    mode,
    // ROK-1544: "answered" is the server stamp, written on the first vote.
    submitted: mySubmittedAt !== null,
    gameName: poll.match.gameName,
    uniqueVoterCount: poll.uniqueVoterCount ?? 0,
    memberCount: poll.match.members.length,
    crossRefs,
    ...resolvePollCreator(poll.match, me),
  });

  const leader = deriveSchedulingLeader(poll.slots);
  /** Null unless the viewer joined after voting had already started. */
  const catchUp = readOnly ? null : deriveCatchUp(poll.match.members, me);
  /** ROK-1546 (AC2): polite announcements for the viewer's vote + the leader. */
  const announcer = useSchedulingAnnouncer(leader);

  /**
   * ROK-1574: one binding for the ballot, spread into the ladder here and
   * into step 2 of the phone game-time sheet — never rebuilt per surface.
   */
  const ladder = useSchedulingLadder({
    poll,
    lineupId,
    matchId,
    readOnly,
    me,
    lock,
    announcer,
  });
  const check = useSchedulingGameTimeCheck(ladder);
  const canVote = ladder.canVote;

  // Suggesting a slot auto-votes for it (server-side), which stamps the
  // suggester the same way a tap does — no client-side submit state to re-arm.
  const handleSuggest = (proposedTime: string): void => {
    // ROK-1545 (review F7): suggesting auto-votes, so the server applies the
    // SAME `assertCallerMayVote` it applies to a vote. Gate on `canVote`, not
    // on `readOnly`, or an anonymous/non-invitee viewer submits a rejected slot.
    if (!canVote) return;
    suggest.mutate(
      { lineupId, matchId, proposedTime },
      {
        // ROK-1546 (AC2): the auto-vote is a vote — say so, on success only.
        onSuccess: () =>
          announcer.announceVote(formatSlotTime(proposedTime).label, true),
      },
    );
    setBetterTimeOpen(false);
  };

  return (
    <section data-testid="scheduling-composite" className="space-y-3">
      <SchedulingAnnouncer message={announcer.message} />
      <SchedulingToolbar
        hero={hero}
        match={poll.match}
        mode={mode}
        lineupId={lineupId}
        matchId={matchId}
        readOnly={readOnly}
        uniqueVoterCount={poll.uniqueVoterCount}
        canLock={ladder.canLock && leader !== null && !readOnly}
        leadingTimeLabel={
          leader ? formatSlotTime(leader.slot.proposedTime).label : ''
        }
        onLockLeader={() => leader && lock.requestLock(leader.slot)}
      />
      <SchedulingTerminalBanner
        pollStatus={pollStatus}
        lockedInTime={poll.lockedInTime ?? null}
        cancelReason={poll.cancelReason ?? null}
        linkedEventId={poll.match.linkedEventId}
      />
      {catchUp && (
        <SchedulingCatchUpLine
          catchUp={catchUp}
          leaderLabel={
            leader ? formatSlotTime(leader.slot.proposedTime).label : null
          }
          deadlineLabel={formatDeadlineLabel(poll.phaseDeadline)}
        />
      )}
      <SchedulingLeaderCard
        slots={poll.slots}
        memberCount={poll.match.members.length}
        phaseDeadline={poll.phaseDeadline}
        readOnly={readOnly}
      />
      {/* ROK-1574: the phone check's step 2 IS this ladder, same binding —
          so the page copy hides while the sheet is up (one ladder in the DOM). */}
      {!check.sheetVisible && <SchedulingSlotList {...ladder} />}
      {check.shell}
      {!readOnly && <SchedulingPendingVoters members={poll.match.members} />}
      {canVote && (
        <SchedulingBetterTimeTrigger onClick={() => setBetterTimeOpen(true)} />
      )}
      <SchedulingBetterTimeSheet
        isOpen={betterTimeOpen}
        onClose={() => setBetterTimeOpen(false)}
      >
        <SchedulingAvailability
          lineupId={lineupId}
          matchId={matchId}
          slots={poll.slots}
          readOnly={readOnly}
          onPrefill={setPrefillTime}
        />
        <SchedulingSuggestForm
          isSuggesting={suggest.isPending}
          prefillTime={prefillTime}
          onSuggest={handleSuggest}
        />
      </SchedulingBetterTimeSheet>
      {lock.pendingSlot && (
        <EarlyCreateConfirmModal
          distinctVoters={lock.pendingDistinctVoters}
          memberCount={poll.match.members.length}
          onCancel={lock.cancelLock}
          onConfirm={lock.confirmLock}
        />
      )}
    </section>
  );
}
