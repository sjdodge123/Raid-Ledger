/**
 * Scheduling Poll Page (ROK-965, ROK-1300).
 * Route: /community-lineup/:lineupId/schedule/:matchId
 *
 * ROK-1300: the active-poll body is `<SchedulingComposite>` — ONE morphing
 * sticky hero owns the page top (no SchedulingWizard stepper, no separate
 * "Scheduling Poll" h1, no standalone MatchContextCard). The composite absorbs
 * the game-ref banner, group-availability heatmap, deadline, operator Cancel,
 * suggested-times list, and sticky-toolbar submit. The page is now a thin
 * fetch/skeleton/not-found wrapper that also handles the scheduled (completed)
 * terminal state and the other-polls section.
 */
import type { JSX } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { useSchedulePoll, useOtherPolls } from '../hooks/use-scheduling';
import { useGameTime } from '../hooks/use-game-time';
import { MatchContextCard } from './scheduling/MatchContextCard';
import { SchedulingComposite } from '../components/lineups/cycle-4/SchedulingComposite';
import { OtherPollsSection } from './scheduling/OtherPollsSection';
import { GameTimeRefreshModal } from './scheduling/GameTimeRefreshModal';

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

/** Active poll body — the composite owns the page chrome (ROK-1300). */
function ActivePollSections({ lineupId, matchId, poll }: {
  lineupId: number; matchId: number; poll: SchedulePollPageResponseDto;
}): JSX.Element {
  const { data: otherPolls, isLoading: otherLoading } = useOtherPolls(lineupId, matchId);
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-20 md:pb-12 space-y-6">
      <SchedulingComposite poll={poll} lineupId={lineupId} matchId={matchId} />
      <OtherPollsSection lineupId={lineupId} data={otherPolls} isLoading={otherLoading} />
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

/** Data-fetching wrapper with loading/error states. */
function SchedulePollContent({ lineupId, matchId }: {
  lineupId: number; matchId: number;
}): JSX.Element {
  const { data: poll, isLoading, error } = useSchedulePoll(lineupId, matchId);
  // Keep the loading gate so the modal doesn't flash before game-time is known;
  // the modal self-fetches the same cached query for its staleness gate.
  const { isLoading: gtLoading } = useGameTime();

  if (isLoading || gtLoading) return <SchedulePollSkeleton />;
  if (error || !poll) return <SchedulePollNotFound />;

  return (
    <>
      <GameTimeRefreshModal />
      <PollSections lineupId={lineupId} matchId={matchId} poll={poll} />
    </>
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
