/**
 * Sx/Ss Scheduling composite (ROK-1300) — top-level component for the
 * scheduling phase of a lineup poll. ONE component, TWO modes driven by
 * `poll.isStandalone`:
 *   - from-match (Ss, false): 4-phase ribbon JourneyHero + "Match N of M" +
 *     "Next: <game>" cross-refs.
 *   - standalone (Sx, true): noRibbon hero, "🗓 Scheduling Poll · started by
 *     you", no cross-match refs.
 *
 * Replaces the legacy `HeroNextStep`/`useLineupHero` hero + the 345-line
 * `CreateEventSection` lock surface. Mirrors the shipped sibling composites
 * (`VotingComposite`, `NominatingComposite`): the submit ritual lives in a
 * sticky, scroll-aware JourneyHero toolbar (NOT a bottom `<SubmitBar>`); the
 * per-row "Lock this time →" affordance is operator/creator-gated.
 */
import { useMemo, type JSX } from 'react';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import {
  useToggleScheduleVote,
  useSuggestSlot,
} from '../../../hooks/use-scheduling';
import { useSubmitScheduling } from '../../../hooks/use-lineup-submit';
import { useLineupMatches } from '../../../hooks/use-lineup-matches';
import { useAuth } from '../../../hooks/use-auth';
import { canBypassThreshold } from '../../../pages/scheduling/threshold';
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
import { SchedulingSlotList } from './SchedulingSlotList';
import { EarlyCreateConfirmModal } from '../../../pages/scheduling/EarlyCreateConfirmModal';

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
  const { data: matches } = useLineupMatches(poll.isStandalone ? undefined : lineupId);
  const lock = useSchedulingLock(poll.match, matchId);

  const mySubmittedAt = useMemo(
    () => poll.match.members.find((m) => m.userId === me)?.schedulingSubmittedAt ?? null,
    [poll.match.members, me],
  );
  const submitState = useScheduleSubmitState(mySubmittedAt, poll.myVotedSlotIds);

  const crossRefs = poll.isStandalone
    ? null
    : deriveCrossRefs(matchId, matches);
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
        submitLabel={submitCopy(submitState.kind, mode)}
        submitted={submitState.submitted}
        submitDisabled={submitState.kind === 'empty' || readOnly}
        submitDisabledReason={
          submitState.kind === 'empty' ? 'pick a time first' : undefined
        }
        nudge={submitNudge(submitState.kind)}
        onSubmit={handleSubmit}
      />
      <SchedulingSlotList
        slots={poll.slots}
        myVotedSlotIds={poll.myVotedSlotIds}
        conflictingSlotIds={poll.conflictingSlotIds ?? []}
        readOnly={readOnly}
        canLock={canLock}
        isSuggesting={suggest.isPending}
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
