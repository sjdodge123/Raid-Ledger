/**
 * Create Event section for the scheduling poll page (ROK-965).
 * User picks a slot, optionally enables recurring, then creates the event.
 */
import { useState } from 'react';
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
  recurring: boolean;
  onRecurringChange: (value: boolean) => void;
  onCreateEvent: (slotId: number) => void;
}

/** Format a slot for display. */
function formatSlot(slot: ScheduleSlotWithVotesDto): string {
  const time = new Date(slot.proposedTime).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const votes = slot.votes.length === 1 ? '1 vote' : `${slot.votes.length} votes`;
  return `${time} (${votes})`;
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

/** Section for creating an event from a selected slot. */
export function CreateEventSection({
  slots, hasVoted, readOnly, createdEventId, matchStatus, isCreating,
  recurring, onRecurringChange, onCreateEvent,
}: CreateEventSectionProps): JSX.Element {
  const sorted = sortedSlots(slots);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(sorted[0]?.id ?? null);

  if (createdEventId) {
    return <CreatedSuccessState eventId={createdEventId} matchStatus={matchStatus} />;
  }

  const canCreate = hasVoted && !readOnly && !isCreating && selectedSlotId !== null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Create Event</h3>
      {slots.length > 0 && (
        <SlotSelector slots={slots} selectedId={selectedSlotId} onChange={setSelectedSlotId} />
      )}
      <RecurringCheckbox checked={recurring} onChange={onRecurringChange} disabled={readOnly} />
      <button type="button" onClick={() => selectedSlotId && onCreateEvent(selectedSlotId)}
        disabled={!canCreate}
        className="px-6 py-2.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        {isCreating ? 'Creating...' : 'Create Event'}
      </button>
      {!hasVoted && !readOnly && (
        <p className="text-xs text-muted">Vote on a time slot to enable event creation.</p>
      )}
    </div>
  );
}
