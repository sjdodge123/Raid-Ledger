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
 * terminal state — including an admin's stalled-lock-in banner (ROK-2033) —
 * and the other-polls section.
 */
import type { JSX } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { useOtherPolls } from '../hooks/use-scheduling';
import { useLiveSchedulePoll } from '../hooks/use-schedule-poll-realtime';
import { useGameTime } from '../hooks/use-game-time';
import { MatchContextCard } from './scheduling/MatchContextCard';
import { SchedulingComposite } from '../components/lineups/cycle-4/SchedulingComposite';
import { SchedulingTerminalBanner } from '../components/lineups/cycle-4/SchedulingTerminalBanner';
import { SchedulingReopenLockInAction } from '../components/lineups/cycle-4/SchedulingReopenLockInAction';
import { OtherPollsSection } from './scheduling/OtherPollsSection';
import { PollPrivateBar } from './scheduling/PollPrivateBar';

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

/**
 * Outcome card for a finished lock-in.
 *
 * ROK-1545: `pollStatusFromMatch` maps `matchStatus === 'scheduled'` to
 * `locked_in`, so the terminal banner renders here — otherwise its locked-in
 * body would be unreachable in the app. The "Poll Complete" card stays: shipped
 * smoke specs resolve `match-status-badge`. ROK-2033: with no linked event the
 * copy no longer claims one was created — a stalled claim never made one.
 */
function CompletedOutcome({ poll }: { poll: SchedulePollPageResponseDto }): JSX.Element {
  const eventId = poll.match.linkedEventId;
  return (
    <>
      <SchedulingTerminalBanner
        pollStatus="locked_in"
        lockedInTime={poll.lockedInTime ?? null}
        cancelReason={null}
        linkedEventId={eventId}
      />
      <div className="p-6 rounded-xl bg-success/10 border border-success/30 text-center space-y-3">
        <div data-testid="match-status-badge"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-success/10 text-success border border-success/30">
          Poll Complete
        </div>
        <p className="text-sm text-success">
          {eventId ? 'The event has been rescheduled.' : 'This poll has been locked in.'}
        </p>
        {eventId && (
          <Link to={`/events/${eventId}`}
            className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
            View Event &rarr;
          </Link>
        )}
      </div>
    </>
  );
}

/**
 * Scheduled-match state. ROK-2033: a lock-in that claimed the match but never
 * linked an event is flagged `lockInRecoverable` for admins only — they get the
 * warning banner + "Reopen lock-in" INSTEAD of the success outcome (it did not
 * succeed). Everyone else keeps the locked-in view (spec Q6: no "stalled" copy
 * for non-admins; the cron recovers it within 15 minutes).
 */
function CompletedPollState({ matchId, poll }: {
  matchId: number; poll: SchedulePollPageResponseDto;
}): JSX.Element {
  const stalled = poll.lockInRecoverable === true;
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-[calc(var(--bottom-nav-clearance)+1rem)] md:pb-12 space-y-6">
      <h1 className="text-xl font-bold text-foreground">Scheduling Poll</h1>
      <PollPrivateBar poll={poll} />
      <SchedulingReopenLockInAction matchId={matchId} recoverable={poll.lockInRecoverable} />
      <MatchContextCard match={poll.match} uniqueVoterCount={poll.uniqueVoterCount} />
      {!stalled && <CompletedOutcome poll={poll} />}
    </div>
  );
}

/** Active poll body — the composite owns the page chrome (ROK-1300). */
function ActivePollSections({ lineupId, matchId, poll }: {
  lineupId: number; matchId: number; poll: SchedulePollPageResponseDto;
}): JSX.Element {
  const { data: otherPolls, isLoading: otherLoading } = useOtherPolls(lineupId, matchId);
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-[calc(var(--bottom-nav-clearance)+1rem)] md:pb-12 space-y-6">
      <PollPrivateBar poll={poll} />
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
    return <CompletedPollState matchId={matchId} poll={poll} />;
  }
  return <ActivePollSections lineupId={lineupId} matchId={matchId} poll={poll} />;
}

/** Data-fetching wrapper with loading/error states. */
function SchedulePollContent({ lineupId, matchId }: {
  lineupId: number; matchId: number;
}): JSX.Element {
  // ROK-1551: votes from other members land live (socket; 10s fallback while disconnected).
  const { data: poll, isLoading, error } = useLiveSchedulePoll(lineupId, matchId);
  // Keep the loading gate so the modal doesn't flash before game-time is known;
  // the modal self-fetches the same cached query for its staleness gate.
  const { isLoading: gtLoading } = useGameTime();

  if (isLoading || gtLoading) return <SchedulePollSkeleton />;
  if (error || !poll) return <SchedulePollNotFound />;

  return (
    <>
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
