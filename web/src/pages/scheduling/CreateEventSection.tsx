/**
 * Create Event section for the scheduling poll page (ROK-965).
 * Shows the leading slot summary, "Create Event" button, and post-creation success state.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';

interface CreateEventSectionProps {
  slots: ScheduleSlotWithVotesDto[];
  hasVoted: boolean;
  readOnly: boolean;
  createdEventId: number | null;
  matchStatus: string;
  isCreating: boolean;
  onCreateEvent: () => void;
}

/** Display the leading (most-voted) slot summary. */
function LeadingSlotSummary({ slots }: {
  slots: ScheduleSlotWithVotesDto[];
}): JSX.Element | null {
  if (slots.length === 0) return null;
  const sorted = [...slots].sort((a, b) => b.votes.length - a.votes.length);
  const leading = sorted[0];
  const time = new Date(leading.proposedTime).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return (
    <p className="text-sm text-muted">
      Leading time: <span className="text-foreground font-medium">{time}</span>
      {' '}({leading.votes.length} {leading.votes.length === 1 ? 'vote' : 'votes'})
    </p>
  );
}

/** Success state displayed after an event has been created. */
function CreatedSuccessState({ eventId, matchStatus }: {
  eventId: number; matchStatus: string;
}): JSX.Element {
  return (
    <div className="space-y-3">
      <div data-testid="match-status-badge"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        {matchStatus === 'scheduled' ? 'Scheduled' : 'Event Created'}
      </div>
      <p className="text-sm text-emerald-400">Event created successfully!</p>
      <Link to={`/events/${eventId}`}
        className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
        View Event
      </Link>
    </div>
  );
}

/** Create event button with disabled-state hint. */
function CreateButton({ hasVoted, readOnly, isCreating, slotsEmpty, onCreateEvent }: {
  hasVoted: boolean; readOnly: boolean; isCreating: boolean; slotsEmpty: boolean; onCreateEvent: () => void;
}): JSX.Element {
  return (
    <>
      <button type="button" onClick={onCreateEvent}
        disabled={!hasVoted || readOnly || isCreating || slotsEmpty}
        className="px-6 py-2.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        {isCreating ? 'Creating...' : 'Create Event'}
      </button>
      {!hasVoted && !readOnly && (
        <p className="text-xs text-muted">Vote on a time slot to enable event creation.</p>
      )}
    </>
  );
}

/** Section for creating an event from the winning slot. */
export function CreateEventSection({
  slots, hasVoted, readOnly, createdEventId, matchStatus, isCreating, onCreateEvent,
}: CreateEventSectionProps): JSX.Element {
  if (createdEventId) {
    return <CreatedSuccessState eventId={createdEventId} matchStatus={matchStatus} />;
  }
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Create Event</h3>
      <LeadingSlotSummary slots={slots} />
      <CreateButton hasVoted={hasVoted} readOnly={readOnly} isCreating={isCreating}
        slotsEmpty={slots.length === 0} onCreateEvent={onCreateEvent} />
    </div>
  );
}
