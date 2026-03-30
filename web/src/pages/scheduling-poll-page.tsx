/**
 * Scheduling Poll Page (ROK-965).
 * Route: /community-lineup/:lineupId/schedule/:matchId
 * Composes match context, suggested times, availability heatmap,
 * event creation, and other polls sections.
 */
import { useState } from 'react';
import type { JSX } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import {
  useSchedulePoll,
  useMatchAvailability,
  useToggleScheduleVote,
  useSuggestSlot,
  useCreateEventFromSlot,
  useOtherPolls,
} from '../hooks/use-scheduling';
import { MatchContextCard } from './scheduling/MatchContextCard';
import { SuggestedTimes } from './scheduling/SuggestedTimes';
import { AvailabilityHeatmapSection } from './scheduling/AvailabilityHeatmapSection';
import { CreateEventSection } from './scheduling/CreateEventSection';
import { OtherPollsSection } from './scheduling/OtherPollsSection';

/** Loading skeleton for the scheduling poll page. */
function SchedulePollSkeleton(): JSX.Element {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 animate-pulse">
      <div className="h-6 bg-overlay rounded w-48" />
      <div className="h-24 bg-overlay rounded" />
      <div className="h-40 bg-overlay rounded" />
    </div>
  );
}

/** Error / not-found state. */
function SchedulePollNotFound(): JSX.Element {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12 text-center">
      <p className="text-muted mb-4">Scheduling poll not found.</p>
      <Link to="/events" className="text-emerald-400 hover:underline text-sm">
        Back to Events
      </Link>
    </div>
  );
}

/** Read-only mode banner shown when the match is not in scheduling status. */
function ReadOnlyBanner(): JSX.Element {
  return (
    <div data-testid="read-only-banner"
      className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
      This poll is read-only. Voting is closed.
    </div>
  );
}

/** Derive read-only status and vote state from poll data. */
function derivePollState(poll: SchedulePollPageResponseDto) {
  const isActive = poll.match.status === 'scheduling' || poll.match.status === 'suggested';
  return { readOnly: !isActive, hasVoted: poll.myVotedSlotIds.length > 0 };
}

/** Aggregate mutation hooks for poll interactions. */
function usePollMutations(lineupId: number, matchId: number) {
  const toggleVote = useToggleScheduleVote();
  const suggest = useSuggestSlot();
  const createEvt = useCreateEventFromSlot();
  return {
    toggleVote: (slotId: number) => toggleVote.mutate({ lineupId, matchId, slotId }),
    suggest: (t: string) => suggest.mutate({ lineupId, matchId, proposedTime: t }),
    isSuggesting: suggest.isPending,
    createEvt,
  };
}

/** Render loaded poll page sections. */
function PollSections({ lineupId, matchId, poll }: {
  lineupId: number; matchId: number; poll: SchedulePollPageResponseDto;
}): JSX.Element {
  const { data: availability, isLoading: availLoading } = useMatchAvailability(lineupId, matchId);
  const { data: otherPolls, isLoading: otherLoading } = useOtherPolls(lineupId, matchId);
  const { toggleVote, suggest, isSuggesting, createEvt } = usePollMutations(lineupId, matchId);
  const [createdEventId, setCreatedEventId] = useState<number | null>(poll.match.linkedEventId ?? null);
  const [recurring, setRecurring] = useState(false);
  const { readOnly, hasVoted } = derivePollState(poll);

  const handleCreate = (): void => {
    if (poll.slots.length === 0) return;
    const sorted = [...poll.slots].sort((a, b) => b.votes.length - a.votes.length);
    createEvt.mutate({ lineupId, matchId, slotId: sorted[0].id, recurring },
      { onSuccess: (r) => setCreatedEventId(r.eventId) });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-xl font-bold text-foreground">Scheduling Poll</h1>
      {readOnly && <ReadOnlyBanner />}
      <MatchContextCard match={poll.match} />
      <SuggestedTimes slots={poll.slots} myVotedSlotIds={poll.myVotedSlotIds}
        readOnly={readOnly} onToggleVote={toggleVote} onSuggestSlot={suggest} isSuggesting={isSuggesting} />
      <AvailabilityHeatmapSection data={availability} isLoading={availLoading} />
      <CreateEventSection slots={poll.slots} hasVoted={hasVoted} readOnly={readOnly}
        createdEventId={createdEventId} matchStatus={poll.match.status}
        isCreating={createEvt.isPending} recurring={recurring}
        onRecurringChange={setRecurring} onCreateEvent={handleCreate} />
      <OtherPollsSection lineupId={lineupId} data={otherPolls} isLoading={otherLoading} />
    </div>
  );
}

/** Data-fetching wrapper with loading/error states. */
function SchedulePollContent({ lineupId, matchId }: {
  lineupId: number; matchId: number;
}): JSX.Element {
  const { data: poll, isLoading, error } = useSchedulePoll(lineupId, matchId);
  if (isLoading) return <SchedulePollSkeleton />;
  if (error || !poll) return <SchedulePollNotFound />;
  return <PollSections lineupId={lineupId} matchId={matchId} poll={poll} />;
}

/** Top-level page component extracting route params. */
export function SchedulingPollPage(): JSX.Element {
  const { lineupId: lid, matchId: mid } = useParams<{ lineupId: string; matchId: string }>();
  const lineupId = lid ? parseInt(lid, 10) : 0;
  const matchId = mid ? parseInt(mid, 10) : 0;
  if (!lineupId || !matchId) return <SchedulePollNotFound />;
  return <SchedulePollContent lineupId={lineupId} matchId={matchId} />;
}
