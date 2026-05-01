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

interface SlotPickerAction {
  /** Button label when idle. */
  label: string;
  /** Optional pending label shown when `pending` is true. */
  pendingLabel?: string;
  /** Whether the action is currently executing (drives pending label + disabled). */
  pending?: boolean;
  /** Tailwind class fragment for the button — e.g. "bg-emerald-600 hover:bg-emerald-500". */
  colorClass: string;
  /** Helper text shown when user hasn't voted yet — e.g. "Vote on a time slot to enable event creation.". */
  unvotedHint: string;
  /** Called with the selected slot once threshold is met (or after the early-create modal confirms). */
  onConfirm: (slot: ScheduleSlotWithVotesDto) => void;
}

/** Helper text below the action button — gate-aware + unvoted-hint fallback. */
function SlotGateHint({ gate, hasVoted, readOnly, unvotedHint }: {
  gate: ThresholdGate; hasVoted: boolean; readOnly: boolean; unvotedHint: string;
}): JSX.Element | null {
  if (gate.showHelperText) {
    return <p className="text-xs text-muted">{gate.helperText}</p>;
  }
  if (!gate.canBypass && !hasVoted && !readOnly) {
    return <p className="text-xs text-muted">{unvotedHint}</p>;
  }
  return null;
}

/** Internal state machine for SlotPickerWithGate — selection + confirm modal + gate. */
function useSlotPickerState(
  slots: ScheduleSlotWithVotesDto[],
  match: MatchDetailResponseDto,
  hasVoted: boolean,
  onConfirm: (slot: ScheduleSlotWithVotesDto) => void,
) {
  const sorted = sortedSlots(slots);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(sorted[0]?.id ?? null);
  const [showConfirm, setShowConfirm] = useState(false);
  const selectedSlot = slots.find((s) => s.id === selectedSlotId);
  const gate = useThresholdGate(match, selectedSlot, hasVoted);
  const handleClick = () => {
    if (!selectedSlot) return;
    if (!gate.thresholdMet) { setShowConfirm(true); return; }
    onConfirm(selectedSlot);
  };
  return {
    selectedSlotId, setSelectedSlotId, selectedSlot,
    showConfirm, setShowConfirm,
    gate, handleClick,
  };
}

/** Action button driven by SlotPickerAction config + gate state. */
function SlotActionButton({ action, gate, hasVoted, readOnly, selectedSlotId, onClick }: {
  action: SlotPickerAction; gate: ThresholdGate; hasVoted: boolean; readOnly: boolean;
  selectedSlotId: number | null; onClick: () => void;
}): JSX.Element {
  const canAct = gate.canBypass || (hasVoted && gate.thresholdMet);
  const disabled = !canAct || readOnly || !!action.pending || selectedSlotId === null;
  const label = action.pending && action.pendingLabel ? action.pendingLabel : action.label;
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`px-6 py-2.5 text-sm font-medium ${action.colorClass} text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}>
      {label}
    </button>
  );
}

/** Slot picker + action button + helper text + early-create confirm modal. */
function SlotPickerWithGate({ slots, match, hasVoted, readOnly, heading, action }: {
  slots: ScheduleSlotWithVotesDto[];
  match: MatchDetailResponseDto;
  hasVoted: boolean;
  readOnly: boolean;
  heading: string;
  action: SlotPickerAction;
}): JSX.Element | null {
  const s = useSlotPickerState(slots, match, hasVoted, action.onConfirm);
  if (s.gate.shouldHide) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">{heading}</h3>
      {slots.length > 0 && (
        <SlotSelector slots={slots} selectedId={s.selectedSlotId} onChange={s.setSelectedSlotId} />
      )}
      <SlotActionButton action={action} gate={s.gate} hasVoted={hasVoted} readOnly={readOnly}
        selectedSlotId={s.selectedSlotId} onClick={s.handleClick} />
      <SlotGateHint gate={s.gate} hasVoted={hasVoted} readOnly={readOnly} unvotedHint={action.unvotedHint} />
      {s.showConfirm && s.selectedSlot && (
        <EarlyCreateConfirmModal
          distinctVoters={s.gate.distinctVoters}
          memberCount={match.members.length}
          onCancel={() => s.setShowConfirm(false)}
          onConfirm={() => { s.setShowConfirm(false); action.onConfirm(s.selectedSlot!); }}
        />
      )}
    </div>
  );
}

/** Hook owning the reschedule mutation + done state for RescheduleFromSlot. */
function useReschedulePerformer(matchId: number, linkedEventId: number) {
  const [done, setDone] = useState(false);
  const reschedule = useRescheduleEvent(linkedEventId);
  const perform = (slot: ScheduleSlotWithVotesDto) => {
    const start = new Date(slot.proposedTime);
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
  return { done, isPending: reschedule.isPending, perform };
}

/** Reschedule the linked event to the selected slot's time. */
function RescheduleFromSlot({ slots, match, matchId, linkedEventId, hasVoted, readOnly }: {
  slots: ScheduleSlotWithVotesDto[]; match: MatchDetailResponseDto; matchId: number;
  linkedEventId: number; hasVoted: boolean; readOnly: boolean;
}): JSX.Element | null {
  const r = useReschedulePerformer(matchId, linkedEventId);
  if (r.done) return <RescheduledSuccessState linkedEventId={linkedEventId} />;
  return (
    <SlotPickerWithGate
      slots={slots} match={match} hasVoted={hasVoted} readOnly={readOnly}
      heading="Reschedule Event"
      action={{
        label: 'Reschedule Event',
        pendingLabel: 'Rescheduling...',
        pending: r.isPending,
        colorClass: 'bg-cyan-600 hover:bg-cyan-500',
        unvotedHint: 'Vote on a time slot to enable rescheduling.',
        onConfirm: r.perform,
      }}
    />
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

  const performNavigate = (slot: ScheduleSlotWithVotesDto) => {
    const start = new Date(slot.proposedTime);
    if (start <= new Date()) { toast.error('Cannot create event for a past time slot'); return; }
    const params = new URLSearchParams();
    if (match.gameId) params.set('gameId', String(match.gameId));
    params.set('startTime', slot.proposedTime);
    params.set('matchId', String(matchId));
    navigate(`/events/new?${params.toString()}`);
  };

  return (
    <SlotPickerWithGate
      slots={slots}
      match={match}
      hasVoted={hasVoted}
      readOnly={readOnly}
      heading="Create Event"
      action={{
        label: 'Create Event',
        colorClass: 'bg-emerald-600 hover:bg-emerald-500',
        unvotedHint: 'Vote on a time slot to enable event creation.',
        onConfirm: performNavigate,
      }}
    />
  );
}
