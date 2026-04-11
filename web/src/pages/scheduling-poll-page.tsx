/**
 * Scheduling Poll Page (ROK-965).
 * Route: /community-lineup/:lineupId/schedule/:matchId
 * Composes match context, suggested times, availability heatmap,
 * event creation, and other polls sections.
 */
import { useState } from 'react';
import type { JSX } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import type { GameTimePreviewBlock } from '../components/features/game-time/game-time-grid.types';
import {
  useSchedulePoll,
  useMatchAvailability,
  useToggleScheduleVote,
  useSuggestSlot,
  useOtherPolls,
  useCancelSchedulePoll,
} from '../hooks/use-scheduling';
import { useAuth, isOperatorOrAdmin } from '../hooks/use-auth';
import { useGameTime } from '../hooks/use-game-time';
import { MatchContextCard } from './scheduling/MatchContextCard';
import { SuggestedTimes } from './scheduling/SuggestedTimes';
import { AvailabilityHeatmapSection } from './scheduling/AvailabilityHeatmapSection';
import { CreateEventSection } from './scheduling/CreateEventSection';
import { OtherPollsSection } from './scheduling/OtherPollsSection';
import { SchedulingWizard } from './scheduling/SchedulingWizard';
import { isWizardSkipped } from './scheduling/scheduling-wizard-utils';

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

/** Convert a dayOfWeek (0=Sun) + hour to a datetime-local in the given week. */
function toDatetimeLocal(dayOfWeek: number, hour: number, weekStart: Date): string {
  const target = new Date(weekStart);
  // weekStart is a Sunday — add dayOfWeek offset
  target.setDate(target.getDate() + dayOfWeek);
  target.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(hour)}:00`;
}

/** Get the Sunday that starts the week containing the given date. */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Convert suggested slots from the API into preview blocks for the grid,
 *  filtered to the visible week so blocks don't persist across week nav. */
function slotsToPreviewBlocks(
  slots: SchedulePollPageResponseDto['slots'],
  weekStart: Date,
): GameTimePreviewBlock[] {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return slots
    .filter((slot) => {
      const d = new Date(slot.proposedTime);
      return d >= weekStart && d < weekEnd;
    })
    .map((slot) => {
      const d = new Date(slot.proposedTime);
      const voteLabel = slot.votes.length === 1 ? '1 vote' : `${slot.votes.length} votes`;
      return {
        dayOfWeek: d.getDay(),
        startHour: d.getHours(),
        endHour: d.getHours() + 2,
        title: voteLabel,
        label: voteLabel,
        variant: 'current' as const,
      };
    });
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
  return {
    toggleVote: (slotId: number) => toggleVote.mutate({ lineupId, matchId, slotId }),
    suggest: (t: string) => suggest.mutate({ lineupId, matchId, proposedTime: t }),
    isSuggesting: suggest.isPending,
  };
}

/** Completed poll state — shown when the match is scheduled and has a linked event. */
function CompletedPollState({ poll }: { poll: SchedulePollPageResponseDto }): JSX.Element {
  const eventId = poll.match.linkedEventId;
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-20 md:pb-12 space-y-6">
      <h1 className="text-xl font-bold text-foreground">Scheduling Poll</h1>
      <MatchContextCard match={poll.match} uniqueVoterCount={poll.uniqueVoterCount} />
      <div className="p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3">
        <div data-testid="match-status-badge"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          Poll Complete
        </div>
        <p className="text-sm text-emerald-400">
          {eventId ? 'The event has been rescheduled.' : 'An event has been created from this poll.'}
        </p>
        {eventId && (
          <Link to={`/events/${eventId}`}
            className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
            View Event &rarr;
          </Link>
        )}
      </div>
    </div>
  );
}

/** Render loaded poll page sections. */
function PollSections({ lineupId, matchId, poll }: {
  lineupId: number; matchId: number; poll: SchedulePollPageResponseDto;
}): JSX.Element {
  if (poll.match.status === 'scheduled') {
    return <CompletedPollState poll={poll} />;
  }

  return <ActivePollSections lineupId={lineupId} matchId={matchId} poll={poll} />;
}

/** Active poll — hooks live here to avoid conditional hook calls in PollSections. */
function ActivePollSections({ lineupId, matchId, poll }: {
  lineupId: number; matchId: number; poll: SchedulePollPageResponseDto;
}): JSX.Element {
  const { data: availability, isLoading: availLoading } = useMatchAvailability(lineupId, matchId);
  const { data: otherPolls, isLoading: otherLoading } = useOtherPolls(lineupId, matchId);
  const { toggleVote, suggest, isSuggesting } = usePollMutations(lineupId, matchId);
  const cancelPoll = useCancelSchedulePoll();
  const { user } = useAuth();
  const navigate = useNavigate();
  /* linkedEventId is a back-reference to the rescheduled event, NOT a newly
     created event. Only set createdEventId when the user creates from this poll. */
  const [createdEventId] = useState<number | null>(null);
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [prefillTime, setPrefillTime] = useState<string | undefined>();
  const [previewBlock, setPreviewBlock] = useState<GameTimePreviewBlock | undefined>();
  const { readOnly, hasVoted } = derivePollState(poll);
  const canCancel = isOperatorOrAdmin(user) && !readOnly;

  const handleWeekChange = (delta: number): void => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + delta * 7);
    setWeekStart(next);
  };

  const handleCancel = () => {
    cancelPoll.mutate({ lineupId, matchId }, { onSuccess: () => navigate('/events') });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-20 md:pb-12 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Scheduling Poll</h1>
        {canCancel && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelPoll.isPending}
            className="px-3 py-1.5 text-xs font-medium text-red-400 border border-red-400/30 rounded-lg hover:bg-red-400/10 transition-colors disabled:opacity-50"
          >
            {cancelPoll.isPending ? 'Cancelling...' : 'Cancel Poll'}
          </button>
        )}
      </div>
      {readOnly && <ReadOnlyBanner />}
      <MatchContextCard match={poll.match} uniqueVoterCount={poll.uniqueVoterCount} />
      <AvailabilityHeatmapSection data={availability} isLoading={availLoading}
        readOnly={readOnly}
        weekStart={weekStart} onWeekChange={handleWeekChange}
        previewBlocks={[
          ...slotsToPreviewBlocks(poll.slots, weekStart),
          ...(previewBlock ? [previewBlock] : []),
        ]}
        onCellClick={(day, hour) => {
          setPrefillTime(toDatetimeLocal(day, hour, weekStart));
          setPreviewBlock({ dayOfWeek: day, startHour: hour, endHour: hour + 2, label: 'Suggested Time', title: 'Suggested Time', variant: 'selected' });
        }} />
      <SuggestedTimes slots={poll.slots} myVotedSlotIds={poll.myVotedSlotIds}
        readOnly={readOnly} onToggleVote={toggleVote} onSuggestSlot={suggest}
        isSuggesting={isSuggesting} prefillTime={prefillTime}
        conflictingSlotIds={poll.conflictingSlotIds} />
      <CreateEventSection slots={poll.slots} match={poll.match} matchId={matchId}
        hasVoted={hasVoted} readOnly={readOnly}
        createdEventId={createdEventId} linkedEventId={poll.match.linkedEventId ?? null}
        matchStatus={poll.match.status} />
      <OtherPollsSection lineupId={lineupId} data={otherPolls} isLoading={otherLoading} />
    </div>
  );
}

/** Data-fetching wrapper with loading/error states + wizard gate (ROK-999). */
function SchedulePollContent({ lineupId, matchId }: {
  lineupId: number; matchId: number;
}): JSX.Element {
  const { data: poll, isLoading, error } = useSchedulePoll(lineupId, matchId);
  const { data: gameTime, isLoading: gtLoading } = useGameTime();

  if (isLoading || gtLoading) return <SchedulePollSkeleton />;
  if (error || !poll) return <SchedulePollNotFound />;

  const stale = !!gameTime?.gameTimeStale && !isWizardSkipped();
  return (
    <SchedulingWizard poll={poll} lineupId={lineupId} matchId={matchId} gameTimeStale={stale}>
      <PollSections lineupId={lineupId} matchId={matchId} poll={poll} />
    </SchedulingWizard>
  );
}

/** Top-level page component extracting route params. */
export function SchedulingPollPage(): JSX.Element {
  const { lineupId: lid, matchId: mid } = useParams<{ lineupId: string; matchId: string }>();
  const lineupId = lid ? parseInt(lid, 10) : 0;
  const matchId = mid ? parseInt(mid, 10) : 0;
  if (!lineupId || !matchId) return <SchedulePollNotFound />;
  return <SchedulePollContent lineupId={lineupId} matchId={matchId} />;
}
