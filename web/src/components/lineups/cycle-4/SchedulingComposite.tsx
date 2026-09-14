/**
 * Sx/Ss Scheduling composite (ROK-1300) — the FULL page body for the
 * scheduling phase of a lineup poll. ONE component, TWO modes driven by
 * `poll.isStandalone`:
 *   - from-match (Ss, false): 4-phase ribbon JourneyHero + "Match N of M" +
 *     "Next: <game>" cross-refs.
 *   - standalone (Sx, true): noRibbon hero, "🗓 Scheduling Poll · started by
 *     <creator | you>" (ROK-1496: names the actual creator), no cross-match refs.
 *
 * Owns the page body per the Sx/Ss wireframe. The sticky hero card hosts, on
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
import {
  useToggleScheduleVote,
  useSuggestSlot,
  type SchedulingVoter,
} from '../../../hooks/use-scheduling';
import { useLineupMatches } from '../../../hooks/use-lineup-matches';
import { useAuth } from '../../../hooks/use-auth';
import { canBypassThreshold } from '../../../pages/scheduling/threshold';
import { EarlyCreateConfirmModal } from '../../../pages/scheduling/EarlyCreateConfirmModal';
import {
  buildSchedulingHero,
  resolvePollCreator,
  schedulingModeFor,
} from './scheduling-hero';
import { deriveCrossRefs } from './scheduling-crossrefs';
import { useSchedulingLock } from './use-scheduling-lock';
import { SchedulingToolbar } from './SchedulingToolbar';
import { SchedulingAvailability } from './SchedulingAvailability';
import { SchedulingSlotList } from './SchedulingSlotList';
import { SchedulingLeaderCard } from './SchedulingLeaderCard';
import { deriveSchedulingLeader } from './scheduling-leader';
import { formatSlotTime } from './scheduling-slot-time';
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
  const isMember = poll.match.members.some((m) => m.userId === me);
  /**
   * ROK-1545 (F-07): no vote affordance where the server would reject the
   * vote. A public-lineup non-member keeps it — voting enrols them, which is
   * deliberate, so the row copy says so.
   */
  const canVote = (poll.canVote ?? !readOnly) && !readOnly;
  const enrolByVoting = canVote && !isMember;

  const toggleVote = useToggleScheduleVote();
  const suggest = useSuggestSlot();
  const { data: matches } = useLineupMatches(
    poll.isStandalone ? undefined : lineupId,
  );
  const lock = useSchedulingLock(poll.match, matchId);
  const [prefillTime, setPrefillTime] = useState<string | undefined>();
  const [betterTimeOpen, setBetterTimeOpen] = useState(false);
  /** Slots with a vote toggle in flight — a second tap on one is ignored. */
  const [pendingSlotIds, setPendingSlotIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const mySubmittedAt = useMemo(
    () =>
      poll.match.members.find((m) => m.userId === me)?.schedulingSubmittedAt ??
      null,
    [poll.match.members, me],
  );

  /**
   * The viewer as a slot voter, so `useToggleScheduleVote` can move the
   * leader card and the row counts on the tap instead of on the refetch.
   * Undefined until they are a poll member — an open-roster first-timer is
   * enrolled by the vote itself, and their numbers arrive with the refetch.
   */
  const viewer = useMemo<SchedulingVoter | undefined>(() => {
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

  const canLock = canBypassThreshold(user, poll.match);
  const leader = deriveSchedulingLeader(poll.slots);
  /** Null unless the viewer joined after voting had already started. */
  const catchUp = readOnly ? null : deriveCatchUp(poll.match.members, me);

  /** Drop a slot from the in-flight set once its toggle settles. */
  const clearPending = (slotId: number): void => {
    setPendingSlotIds((prev) => {
      const next = new Set(prev);
      next.delete(slotId);
      return next;
    });
  };

  /**
   * One tap = the whole action. The mutation writes optimistically and rolls
   * back with a toast on failure (`useToggleScheduleVote`), so nothing else
   * is needed to commit a vote or a change of mind.
   *
   * ROK-1543: a second tap on the SAME slot while the first is in flight is
   * ignored — two overlapping toggles snapshot each other's optimistic state,
   * so a failure of the first would roll back past the second.
   */
  const handleToggleVote = (slotId: number): void => {
    if (!canVote || pendingSlotIds.has(slotId)) return;
    setPendingSlotIds((prev) => new Set(prev).add(slotId));
    toggleVote.mutate(
      { lineupId, matchId, slotId, viewer },
      { onSettled: () => clearPending(slotId) },
    );
  };

  // Suggesting a slot auto-votes for it (server-side), which stamps the
  // suggester the same way a tap does — no client-side submit state to re-arm.
  const handleSuggest = (proposedTime: string): void => {
    if (readOnly) return;
    suggest.mutate({ lineupId, matchId, proposedTime });
    setBetterTimeOpen(false);
  };

  return (
    <section data-testid="scheduling-composite" className="space-y-3">
      <SchedulingToolbar
        hero={hero}
        match={poll.match}
        mode={mode}
        lineupId={lineupId}
        matchId={matchId}
        readOnly={readOnly}
        uniqueVoterCount={poll.uniqueVoterCount}
        canLock={canLock && leader !== null && !readOnly}
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
      <SchedulingSlotList
        slots={poll.slots}
        myVotedSlotIds={poll.myVotedSlotIds}
        slotConflicts={poll.slotConflicts ?? []}
        readOnly={readOnly}
        canVote={canVote}
        enrolByVoting={enrolByVoting}
        canLock={canLock}
        onToggleVote={handleToggleVote}
        onLock={lock.requestLock}
      />
      {!readOnly && <SchedulingPendingVoters members={poll.match.members} />}
      {!readOnly && (
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
