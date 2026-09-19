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
import { useExpiredLockIn } from './use-expired-lock-in';
import { useSchedulingLadder } from './use-scheduling-ladder';
import { SchedulingToolbar } from './SchedulingToolbar';
import { SchedulingAvailability } from './SchedulingAvailability';
import { SchedulingSlotList } from './SchedulingSlotList';
import { useSchedulingGameTimeCheck } from './SchedulingGameTimeCheck';
import { SchedulingLeaderCard } from './SchedulingLeaderCard';
import { SchedulingLeaderMenu } from './SchedulingLeaderMenu';
import { rallyPendingCount } from './scheduling-manage.helpers';
import { deriveSchedulingLeader } from './scheduling-leader';
import { formatSlotTime } from './scheduling-slot-time';
import { useSchedulingAnnouncer } from './use-scheduling-announcer';
import { SchedulingAnnouncer } from './SchedulingAnnouncer';
import { SchedulingSuggestForm } from './SchedulingSuggestForm';
import {
  SchedulingBetterTimeSheet,
  SchedulingBetterTimeTrigger,
} from './SchedulingBetterTimeSheet';
import { SchedulingTerminalBanner } from './SchedulingTerminalBanner';
import { resolvePollStatus } from './scheduling-poll-status';
import { useLockDeepLink } from './use-lock-deep-link';
import { useVoteSource } from './use-vote-source';
import { SchedulingCatchUpLine } from './SchedulingCatchUpLine';
import { SchedulingPendingVoters } from './SchedulingPendingVoters';
import { deriveCatchUp, formatDeadlineLabel } from './scheduling-catch-up';

export interface SchedulingCompositeProps {
  poll: SchedulePollPageResponseDto;
  lineupId: number;
  matchId: number;
}

/** Sx/Ss Scheduling composite — see file-level docstring. */
export function SchedulingComposite(
  props: SchedulingCompositeProps,
): JSX.Element {
  const { poll, lineupId, matchId } = props;
  const { user, isLoading: authLoading } = useAuth();
  const me = user?.id ?? null;
  const mode = schedulingModeFor(poll.isStandalone);
  const pollStatus = resolvePollStatus(poll);
  const readOnly = pollStatus !== 'open';
  const suggest = useSuggestSlot();
  // ROK-1550: the poll's own visit source — the ladder's votes and this
  // surface's suggestions must be attributed to the same arrival.
  const voteSource = useVoteSource();
  const { data: matches } = useLineupMatches(
    poll.isStandalone ? undefined : lineupId,
  );
  const lock = useSchedulingLock(poll.match, matchId, lineupId);
  // ROK-1610: an expired poll the viewer may still finish. Its lock-in is a
  // different write (no refetch-must-be-open guard, no create form), so when
  // it is live the ladder's per-row lock routes here instead.
  const expiredLock = useExpiredLockIn({ poll, lineupId, matchId });
  // ROK-1604 (AC2): a DM's `?lock=<slotId>` opens this slot's confirm.
  useLockDeepLink({ poll, lock, user, authLoading });
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
    lock: expiredLock.active ? { requestLock: expiredLock.request } : lock,
    announcer,
  });
  const check = useSchedulingGameTimeCheck();
  const canVote = ladder.canVote;
  /**
   * Review fix: suggesting outlives voting in exactly one state — the
   * deadline is still ahead but every proposed time has passed. The Discord
   * card for that poll says "suggest a new time or start a new poll" and the
   * server still accepts the suggestion, so the page keeps the form (the vote
   * buttons stay gone — `canVote` is what hides those). `canVote ||` keeps an
   * OPEN poll bit-identical to today.
   */
  const canSuggest = canVote || poll.canSuggest === true;

  // Suggesting a slot auto-votes for it (server-side), which stamps the
  // suggester the same way a tap does — no client-side submit state to re-arm.
  const handleSuggest = (proposedTime: string): void => {
    // ROK-1545 (review F7): suggesting auto-votes, so the server applies the
    // SAME `assertCallerMayVote` it applies to a vote. Gate on eligibility,
    // not on `readOnly`, or an anonymous/non-invitee viewer submits a
    // rejected slot.
    if (!canSuggest) return;
    suggest.mutate(
      // ROK-1550: the server auto-votes for the slot, so the suggestion
      // carries this visit's source or that vote lands as a web vote.
      { lineupId, matchId, proposedTime, source: voteSource },
      {
        // ROK-1546 (AC2): the auto-vote is a vote — say so, on success only.
        onSuccess: () =>
          announcer.announceVote(formatSlotTime(proposedTime).label, 'yes'),
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
      />
      <SchedulingTerminalBanner
        pollStatus={pollStatus}
        lockedInTime={poll.lockedInTime ?? null}
        cancelReason={poll.cancelReason ?? null}
        linkedEventId={poll.match.linkedEventId}
        lockInLabel={
          expiredLock.slot
            ? formatSlotTime(expiredLock.slot.proposedTime).label
            : null
        }
        onLockIn={
          expiredLock.slot
            ? () => expiredLock.slot && expiredLock.request(expiredLock.slot)
            : undefined
        }
        timesPassed={canSuggest && readOnly}
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
        menu={
          /* ROK-1618: the SAME gate the toolbar's floating lock used, now on
             the card that names the time it locks. */
          <SchedulingLeaderMenu
            lineupId={lineupId}
            matchId={matchId}
            readOnly={readOnly}
            canLock={ladder.canLock && leader !== null}
            leadingTimeLabel={
              leader ? formatSlotTime(leader.slot.proposedTime).label : ''
            }
            /* The RALLY audience, not the poll-wide one: the server nudges
               members with no stance on a still-future slot (ROK-1618). */
            pendingVoterCount={rallyPendingCount({
              members: poll.match.members,
              slots: poll.slots,
              viewerId: me,
            })}
            onLock={() => leader && void lock.requestLock(leader.slot)}
          />
        }
      />
      {/* ROK-1574: the phone check's step 2 IS this ladder, same binding —
          so the page copy hides while the sheet is up (one ladder in the DOM). */}
      {!check.sheetVisible && <SchedulingSlotList {...ladder} />}
      {check.shell}
      {!readOnly && <SchedulingPendingVoters members={poll.match.members} />}
      {canSuggest && (
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
          readOnly={!canSuggest}
          onPrefill={setPrefillTime}
        />
        <SchedulingSuggestForm
          isSuggesting={suggest.isPending}
          prefillTime={prefillTime}
          onSuggest={handleSuggest}
        />
      </SchedulingBetterTimeSheet>
      {expiredLock.pendingSlot && (
        <EarlyCreateConfirmModal
          variant="expired"
          distinctVoters={expiredLock.pendingDistinctVoters}
          memberCount={expiredLock.memberCount}
          timeLabel={formatSlotTime(expiredLock.pendingSlot.proposedTime).label}
          onCancel={expiredLock.cancel}
          onConfirm={expiredLock.confirm}
        />
      )}
      {lock.pendingSlot && (
        <EarlyCreateConfirmModal
          distinctVoters={lock.pendingDistinctVoters}
          memberCount={lock.pendingMemberCount}
          timeLabel={formatSlotTime(lock.pendingSlot.proposedTime).label}
          onCancel={lock.cancelLock}
          onConfirm={lock.confirmLock}
        />
      )}
    </section>
  );
}
