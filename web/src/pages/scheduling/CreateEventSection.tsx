/**
 * Create Event section for the scheduling poll page (ROK-965).
 * User picks a slot, optionally enables recurring, then creates the event.
 *
 * ROK-1121: Create / Reschedule actions are gated behind a majority-voter
 * threshold (max(2, floor(N/2)+1) distinct voters on the selected slot).
 * Operators, admins, and the lineup creator can bypass with a confirm modal.
 */
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
    ScheduleSlotWithVotesDto,
    MatchDetailResponseDto,
} from '@raid-ledger/contract';
import { useAuth } from '../../hooks/use-auth';
import { useRescheduleEvent } from '../../hooks/use-reschedule';
import { completeStandalonePoll } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import {
    computeRequiredVoters,
    countDistinctVoters,
    canBypassThreshold,
} from './threshold';
import { EarlyCreateConfirmModal } from './EarlyCreateConfirmModal';

interface CreateEventSectionProps {
  slots: ScheduleSlotWithVotesDto[];
  match: MatchDetailResponseDto;
  matchId: number;
  hasVoted: boolean;
  readOnly: boolean;
  createdEventId: number | null;
  linkedEventId: number | null;
  matchStatus: string;
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

interface ThresholdGate {
  canBypass: boolean;
  requiredVoters: number;
  distinctVoters: number;
  thresholdMet: boolean;
  shouldHide: boolean;
  showHelperText: boolean;
  helperText: string;
}

/** Compute the gate state for a slot + match + user. */
function useThresholdGate(
  match: MatchDetailResponseDto,
  selectedSlot: ScheduleSlotWithVotesDto | undefined,
  hasVoted: boolean,
): ThresholdGate {
  const { user } = useAuth();
  return useMemo(() => {
    const memberCount = match.members.length;
    const canBypass = canBypassThreshold(user, match);
    const requiredVoters = computeRequiredVoters(memberCount);
    const distinctVoters = countDistinctVoters(selectedSlot);
    const thresholdMet = distinctVoters >= requiredVoters;
    const shouldHide = !canBypass && !hasVoted;
    const showHelperText = !canBypass && hasVoted && !thresholdMet;
    const helperText = `${distinctVoters} of ${memberCount} participants have voted — Create Event unlocks when majority has chosen a time`;
    return {
      canBypass,
      requiredVoters,
      distinctVoters,
      thresholdMet,
      shouldHide,
      showHelperText,
      helperText,
    };
  }, [user, match, selectedSlot, hasVoted]);
}

/** Section for creating an event or rescheduling from a selected slot. */
export function CreateEventSection({
  slots, match, matchId, hasVoted, readOnly, createdEventId, linkedEventId,
  matchStatus,
}: CreateEventSectionProps): JSX.Element | null {
  const isReschedule = linkedEventId !== null;

  if (createdEventId) {
    return <CreatedSuccessState eventId={createdEventId} matchStatus={matchStatus} />;
  }

  if (isReschedule) {
    return <RescheduleFromSlot slots={slots} match={match} matchId={matchId}
      linkedEventId={linkedEventId} hasVoted={hasVoted} readOnly={readOnly} />;
  }

  return <CreateFromSlot slots={slots} match={match} matchId={matchId}
    hasVoted={hasVoted} readOnly={readOnly} />;
}

/** Reschedule the linked event to the selected slot's time. */
function RescheduleFromSlot({ slots, match, matchId, linkedEventId, hasVoted, readOnly }: {
  slots: ScheduleSlotWithVotesDto[]; match: MatchDetailResponseDto; matchId: number;
  linkedEventId: number; hasVoted: boolean; readOnly: boolean;
}): JSX.Element | null {
  const sorted = sortedSlots(slots);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(sorted[0]?.id ?? null);
  const [done, setDone] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const reschedule = useRescheduleEvent(linkedEventId);
  const selectedSlot = slots.find((s) => s.id === selectedSlotId);
  const gate = useThresholdGate(match, selectedSlot, hasVoted);

  const performReschedule = () => {
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

  const handleClick = () => {
    if (!gate.thresholdMet) { setShowConfirm(true); return; }
    performReschedule();
  };

  if (done) return <RescheduledSuccessState linkedEventId={linkedEventId} />;
  if (gate.shouldHide) return null;

  const canAct = gate.canBypass || (hasVoted && gate.thresholdMet);
  const buttonDisabled = !canAct || readOnly || reschedule.isPending || selectedSlotId === null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Reschedule Event</h3>
      {slots.length > 0 && (
        <SlotSelector slots={slots} selectedId={selectedSlotId} onChange={setSelectedSlotId} />
      )}
      <button type="button" onClick={handleClick} disabled={buttonDisabled}
        className="px-6 py-2.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        {reschedule.isPending ? 'Rescheduling...' : 'Reschedule Event'}
      </button>
      {gate.showHelperText && (
        <p className="text-xs text-muted">{gate.helperText}</p>
      )}
      {!gate.showHelperText && !gate.canBypass && !hasVoted && !readOnly && (
        <p className="text-xs text-muted">Vote on a time slot to enable rescheduling.</p>
      )}
      {showConfirm && (
        <EarlyCreateConfirmModal
          distinctVoters={gate.distinctVoters}
          memberCount={match.members.length}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => { setShowConfirm(false); performReschedule(); }}
        />
      )}
    </div>
  );
}

/** Success state for a completed reschedule. */
function RescheduledSuccessState({ linkedEventId }: { linkedEventId: number }): JSX.Element {
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

/** Navigate to create-event page with pre-filled data from the selected slot. */
function CreateFromSlot({ slots, match, matchId, hasVoted, readOnly }: {
  slots: ScheduleSlotWithVotesDto[]; match: MatchDetailResponseDto;
  matchId: number; hasVoted: boolean; readOnly: boolean;
}): JSX.Element | null {
  const navigate = useNavigate();
  const sorted = sortedSlots(slots);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(sorted[0]?.id ?? null);
  const [showConfirm, setShowConfirm] = useState(false);
  const selectedSlot = slots.find((s) => s.id === selectedSlotId);
  const gate = useThresholdGate(match, selectedSlot, hasVoted);

  const performNavigate = () => {
    if (!selectedSlot) return;
    const start = new Date(selectedSlot.proposedTime);
    if (start <= new Date()) { toast.error('Cannot create event for a past time slot'); return; }
    const params = new URLSearchParams();
    if (match.gameId) params.set('gameId', String(match.gameId));
    params.set('startTime', selectedSlot.proposedTime);
    params.set('matchId', String(matchId));
    navigate(`/events/new?${params.toString()}`);
  };

  const handleClick = () => {
    if (!gate.thresholdMet) { setShowConfirm(true); return; }
    performNavigate();
  };

  if (gate.shouldHide) return null;

  const canAct = gate.canBypass || (hasVoted && gate.thresholdMet);
  const buttonDisabled = !canAct || readOnly || selectedSlotId === null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Create Event</h3>
      {slots.length > 0 && (
        <SlotSelector slots={slots} selectedId={selectedSlotId} onChange={setSelectedSlotId} />
      )}
      <button type="button" onClick={handleClick} disabled={buttonDisabled}
        className="px-6 py-2.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        Create Event
      </button>
      {gate.showHelperText && (
        <p className="text-xs text-muted">{gate.helperText}</p>
      )}
      {!gate.showHelperText && !gate.canBypass && !hasVoted && !readOnly && (
        <p className="text-xs text-muted">Vote on a time slot to enable event creation.</p>
      )}
      {showConfirm && (
        <EarlyCreateConfirmModal
          distinctVoters={gate.distinctVoters}
          memberCount={match.members.length}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => { setShowConfirm(false); performNavigate(); }}
        />
      )}
    </div>
  );
}
