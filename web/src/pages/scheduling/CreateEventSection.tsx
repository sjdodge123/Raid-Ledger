/**
 * Create Event section for the scheduling poll page (ROK-965).
 * User picks a slot, optionally enables recurring, then creates the event.
 */
import { useState } from 'react';
import type { JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ScheduleSlotWithVotesDto, MatchDetailResponseDto } from '@raid-ledger/contract';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';
import { useRescheduleEvent } from '../../hooks/use-reschedule';
import { completeStandalonePoll } from '../../lib/api-client';
import { toast } from '../../lib/toast';

interface CreateEventSectionProps {
  slots: ScheduleSlotWithVotesDto[];
  match: MatchDetailResponseDto;
  matchId: number;
  hasVoted: boolean;
  readOnly: boolean;
  createdEventId: number | null;
  linkedEventId: number | null;
  matchStatus: string;
  isCreating: boolean;
  recurring: boolean;
  onRecurringChange: (value: boolean) => void;
  onCreateEvent: (slotId: number) => void;
}

/** Format a slot for display, marking past slots. */
function formatSlot(slot: ScheduleSlotWithVotesDto): string {
  const d = new Date(slot.proposedTime);
  const isPast = d <= new Date();
  const time = d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const votes = slot.votes.length === 1 ? '1 vote' : `${slot.votes.length} votes`;
  return isPast ? `${time} (${votes}) — past` : `${time} (${votes})`;
}

/** Sort slots by votes descending, then by date ascending. */
function sortedSlots(slots: ScheduleSlotWithVotesDto[]) {
  return [...slots].sort((a, b) =>
    b.votes.length - a.votes.length || new Date(a.proposedTime).getTime() - new Date(b.proposedTime).getTime(),
  );
}

/** Slot selector dropdown. */
function SlotSelector({ slots, selectedId, onChange }: {
  slots: ScheduleSlotWithVotesDto[]; selectedId: number | null; onChange: (id: number) => void;
}): JSX.Element {
  const sorted = sortedSlots(slots);
  return (
    <select
      value={selectedId ?? ''}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-sm text-foreground focus:ring-2 focus:ring-emerald-500 focus:outline-none"
    >
      <option value="" disabled>Select a time slot...</option>
      {sorted.map((slot) => (
        <option key={slot.id} value={slot.id}>{formatSlot(slot)}</option>
      ))}
    </select>
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
        View Event &rarr;
      </Link>
    </div>
  );
}

/** Recurring series checkbox. */
function RecurringCheckbox({ checked, onChange, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; disabled: boolean;
}): JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-edge bg-panel text-emerald-500 focus:ring-emerald-500" />
      Repeat weekly for 4 weeks
    </label>
  );
}

/** Compute how many match members have participated (voted on any slot). */
function getParticipation(match: MatchDetailResponseDto, slots: ScheduleSlotWithVotesDto[]) {
  const voterIds = new Set(slots.flatMap((s) => s.votes.map((v) => v.userId)));
  const total = match.members.length;
  const voted = match.members.filter((m) => voterIds.has(m.userId)).length;
  return { voted, total, allVoted: voted >= total };
}

/** Participation banner shown when not all members have voted. */
function ParticipationBanner({ voted, total }: { voted: number; total: number }): JSX.Element {
  const remaining = total - voted;
  return (
    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
      {remaining} of {total} {remaining === 1 ? 'member hasn\u2019t' : 'members haven\u2019t'} voted yet.
    </div>
  );
}

/** Section for creating an event or rescheduling from a selected slot. */
export function CreateEventSection({
  slots, match, matchId, hasVoted, readOnly, createdEventId, linkedEventId,
  matchStatus, isCreating, recurring, onRecurringChange, onCreateEvent,
}: CreateEventSectionProps): JSX.Element {
  const isReschedule = linkedEventId !== null;

  if (createdEventId) {
    return <CreatedSuccessState eventId={createdEventId} matchStatus={matchStatus} />;
  }

  if (isReschedule) {
    return <RescheduleFromSlot slots={slots} matchId={matchId}
      linkedEventId={linkedEventId} hasVoted={hasVoted} readOnly={readOnly} />;
  }

  return <CreateFromSlot slots={slots} match={match} matchId={matchId}
    hasVoted={hasVoted} readOnly={readOnly} />;
}

/** Reschedule the linked event to the selected slot's time. */
function RescheduleFromSlot({ slots, matchId, linkedEventId, hasVoted, readOnly }: {
  slots: ScheduleSlotWithVotesDto[]; matchId: number; linkedEventId: number;
  hasVoted: boolean; readOnly: boolean;
}): JSX.Element {
  const sorted = sortedSlots(slots);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(sorted[0]?.id ?? null);
  const [done, setDone] = useState(false);
  const reschedule = useRescheduleEvent(linkedEventId);
  const selectedSlot = slots.find((s) => s.id === selectedSlotId);
  const canAct = hasVoted && !readOnly && !reschedule.isPending && selectedSlotId !== null;

  const handleReschedule = () => {
    if (!selectedSlot) return;
    const start = new Date(selectedSlot.proposedTime);
    if (start <= new Date()) {
      toast.error('Cannot reschedule to a time in the past');
      return;
    }
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    reschedule.mutate(
      { startTime: start.toISOString(), endTime: end.toISOString() },
      {
        onSuccess: () => { void completeStandalonePoll(matchId); setDone(true); },
        onError: (err) => { toast.error(err instanceof Error ? err.message : 'Failed to reschedule'); },
      },
    );
  };

  if (done) {
    return (
      <div className="space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          Rescheduled
        </div>
        <p className="text-sm text-emerald-400">Event rescheduled successfully!</p>
        <Link to={`/events/${linkedEventId}`}
          className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
          View Event &rarr;
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Reschedule Event</h3>
      {slots.length > 0 && (
        <SlotSelector slots={slots} selectedId={selectedSlotId} onChange={setSelectedSlotId} />
      )}
      <button type="button" onClick={handleReschedule} disabled={!canAct}
        className="px-6 py-2.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        {reschedule.isPending ? 'Rescheduling...' : 'Reschedule Event'}
      </button>
      {!hasVoted && !readOnly && (
        <p className="text-xs text-muted">Vote on a time slot to enable rescheduling.</p>
      )}
    </div>
  );
}

/** Navigate to create-event page with pre-filled data from the selected slot. */
function CreateFromSlot({ slots, match, matchId, hasVoted, readOnly }: {
  slots: ScheduleSlotWithVotesDto[]; match: MatchDetailResponseDto;
  matchId: number; hasVoted: boolean; readOnly: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  const sorted = sortedSlots(slots);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(sorted[0]?.id ?? null);
  const selectedSlot = slots.find((s) => s.id === selectedSlotId);
  const canCreate = hasVoted && !readOnly && selectedSlotId !== null;

  const handleCreate = () => {
    if (!selectedSlot) return;
    const start = new Date(selectedSlot.proposedTime);
    if (start <= new Date()) { toast.error('Cannot create event for a past time slot'); return; }
    const params = new URLSearchParams();
    if (match.game?.id) params.set('gameId', String(match.game.id));
    params.set('startTime', selectedSlot.proposedTime);
    params.set('matchId', String(matchId));
    navigate(`/events/new?${params.toString()}`);
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Create Event</h3>
      {slots.length > 0 && (
        <SlotSelector slots={slots} selectedId={selectedSlotId} onChange={setSelectedSlotId} />
      )}
      <button type="button" onClick={handleCreate} disabled={!canCreate}
        className="px-6 py-2.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        Create Event
      </button>
      {!hasVoted && !readOnly && (
        <p className="text-xs text-muted">Vote on a time slot to enable event creation.</p>
      )}
    </div>
  );
}
