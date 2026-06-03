/**
 * Sx/Ss Scheduling composite (ROK-1300) — the FULL page body for the
 * scheduling phase of a lineup poll. ONE component, TWO modes driven by
 * `poll.isStandalone`:
 *   - from-match (Ss, false): 4-phase ribbon JourneyHero + "Match N of M" +
 *     "Next: <game>" cross-refs.
 *   - standalone (Sx, true): noRibbon hero, "🗓 Scheduling Poll · started by
 *     you", no cross-match refs.
 *
 * Owns the page body per the Sx/Ss wireframe. Rework round 2: the sticky hero
 * card now hosts, on ONE row, the clickable U2 game-ref (left, → /games/:id)
 * and the submit button (right); operator Cancel sits at the card's top-right
 * — all inside `SchedulingToolbar`. Below the card: phase-deadline banner,
 * read-only banner, group-availability heatmap, suggested-times list. Replaces
 * the legacy HeroNextStep/useLineupHero hero, the SchedulingWizard stepper, and
 * the 345-line CreateEventSection. Mirrors the shipped siblings (VotingComposite,
 * NominatingComposite): submit lives in the sticky toolbar (NOT a bottom
 * <SubmitBar>); per-row "Lock this time →" is operator/creator-gated.
 */
import { useMemo, useState, type JSX } from 'react';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import {
  useToggleScheduleVote,
  useSuggestSlot,
} from '../../../hooks/use-scheduling';
import { useSubmitScheduling } from '../../../hooks/use-lineup-submit';
import { useLineupMatches } from '../../../hooks/use-lineup-matches';
import { useAuth } from '../../../hooks/use-auth';
import { canBypassThreshold } from '../../../pages/scheduling/threshold';
import { PollDeadlineBanner } from '../../../pages/scheduling/PollDeadlineBanner';
import { EarlyCreateConfirmModal } from '../../../pages/scheduling/EarlyCreateConfirmModal';
import { toast } from '../../../lib/toast';
import { buildSchedulingHero } from './scheduling-hero';
import { deriveCrossRefs } from './scheduling-crossrefs';
import {
  schedulingModeFor,
  submitCopy,
  submitNudge,
} from './scheduling-submit-copy';
import { useScheduleSubmitState } from './use-schedule-submit-state';
import { useSchedulingLock } from './use-scheduling-lock';
import { SchedulingToolbar } from './SchedulingToolbar';
import { SchedulingAvailability } from './SchedulingAvailability';
import { SchedulingSlotList } from './SchedulingSlotList';

export interface SchedulingCompositeProps {
  poll: SchedulePollPageResponseDto;
  lineupId: number;
  matchId: number;
}

/** Read-only iff the match is no longer accepting votes. */
function isReadOnly(poll: SchedulePollPageResponseDto): boolean {
  return poll.match.status !== 'scheduling' && poll.match.status !== 'suggested';
}

/** Sx/Ss Scheduling composite — see file-level docstring. */
export function SchedulingComposite(
  props: SchedulingCompositeProps,
): JSX.Element {
  const { poll, lineupId, matchId } = props;
  const { user } = useAuth();
  const me = user?.id ?? null;
  const mode = schedulingModeFor(poll.isStandalone);
  const readOnly = isReadOnly(poll);

  const toggleVote = useToggleScheduleVote();
  const suggest = useSuggestSlot();
  const submitScheduling = useSubmitScheduling();
  const { data: matches } = useLineupMatches(
    poll.isStandalone ? undefined : lineupId,
  );
  const lock = useSchedulingLock(poll.match, matchId);
  const [prefillTime, setPrefillTime] = useState<string | undefined>();

  const mySubmittedAt = useMemo(
    () =>
      poll.match.members.find((m) => m.userId === me)?.schedulingSubmittedAt ??
      null,
    [poll.match.members, me],
  );
  const submitState = useScheduleSubmitState(mySubmittedAt, poll.myVotedSlotIds);

  const crossRefs = poll.isStandalone ? null : deriveCrossRefs(matchId, matches);
  const hero = buildSchedulingHero({
    mode,
    submitted: submitState.submitted,
    gameName: poll.match.gameName,
    uniqueVoterCount: poll.uniqueVoterCount ?? 0,
    memberCount: poll.match.members.length,
    crossRefs,
  });

  const canLock = canBypassThreshold(user, poll.match);

  const handleToggleVote = (slotId: number): void => {
    if (readOnly) return;
    submitState.markDirty();
    toggleVote.mutate({ lineupId, matchId, slotId });
  };

  const handleSubmit = (): void => {
    if (submitState.kind === 'post') {
      submitState.unlock();
      return;
    }
    submitScheduling.mutate(
      { lineupId, matchId },
      {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Submit failed'),
      },
    );
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
        submitLabel={submitCopy(submitState.kind, mode)}
        submitted={submitState.submitted}
        submitDisabled={submitState.kind === 'empty' || readOnly}
        submitDisabledReason={
          submitState.kind === 'empty' ? 'pick a time first' : undefined
        }
        nudge={submitNudge(submitState.kind)}
        onSubmit={handleSubmit}
      />
      <PollDeadlineBanner phaseDeadline={poll.phaseDeadline} />
      {readOnly && (
        <div
          data-testid="read-only-banner"
          className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300"
        >
          This poll is read-only. Voting is closed.
        </div>
      )}
      <SchedulingAvailability
        lineupId={lineupId}
        matchId={matchId}
        slots={poll.slots}
        readOnly={readOnly}
        onPrefill={setPrefillTime}
      />
      <SchedulingSlotList
        slots={poll.slots}
        myVotedSlotIds={poll.myVotedSlotIds}
        conflictingSlotIds={poll.conflictingSlotIds ?? []}
        readOnly={readOnly}
        canLock={canLock}
        isSuggesting={suggest.isPending}
        prefillTime={prefillTime}
        onToggleVote={handleToggleVote}
        onLock={lock.requestLock}
        onSuggest={(t) => suggest.mutate({ lineupId, matchId, proposedTime: t })}
      />
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
