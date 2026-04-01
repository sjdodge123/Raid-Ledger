/**
 * Suggested time slots section for scheduling poll (ROK-965).
 * Displays slot cards with vote counts, toggle-vote on click,
 * "You voted" indicator, and a "Suggest Time" button with datetime picker.
 */
import { useState, useRef } from 'react';
import type { JSX } from 'react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';

interface SuggestedTimesProps {
  slots: ScheduleSlotWithVotesDto[];
  myVotedSlotIds: number[];
  readOnly: boolean;
  onToggleVote: (slotId: number) => void;
  onSuggestSlot: (proposedTime: string) => void;
  isSuggesting: boolean;
  /** Pre-filled datetime from heatmap grid click (ISO local format for datetime-local input). */
  prefillTime?: string;
  /** Sunday of the currently selected week. */
  weekStart: Date;
  /** Shift the selected week by +1 or -1. */
  onWeekChange: (delta: number) => void;
}

/** Format a datetime string for display. */
function formatSlotTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/** Compute slot card style classes based on voted/readOnly state. */
function slotCardClasses(isVoted: boolean, readOnly: boolean): string {
  const base = 'w-full text-left p-3 rounded-lg border transition-colors';
  const voted = isVoted
    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
    : 'bg-panel border-edge text-foreground hover:border-dim';
  const cursor = readOnly ? 'cursor-default opacity-70' : 'cursor-pointer';
  return `${base} ${voted} ${cursor}`;
}

/** Single slot card with vote toggle behavior. */
function SlotCard({ slot, isVoted, readOnly, onToggle }: {
  slot: ScheduleSlotWithVotesDto; isVoted: boolean; readOnly: boolean; onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid="schedule-slot"
      data-voted={isVoted ? 'true' : 'false'}
      onClick={readOnly ? undefined : onToggle}
      disabled={readOnly}
      className={slotCardClasses(isVoted, readOnly)}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{formatSlotTime(slot.proposedTime)}</span>
        <span className="text-xs text-muted">
          {slot.votes.length} {slot.votes.length === 1 ? 'vote' : 'votes'}
        </span>
      </div>
      {isVoted && <p className="text-xs text-emerald-400 mt-1">You voted</p>}
    </button>
  );
}

/** Format a week range label from a Sunday date. */
function weekLabel(sun: Date): string {
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(sun)} – ${fmt(sat)}`;
}

/** Date picker with week navigation for suggesting a new slot. */
function SuggestSlotForm({ onSubmit, isSuggesting, prefillTime, weekStart, onWeekChange }: {
  onSubmit: (time: string) => void; isSuggesting: boolean; prefillTime?: string;
  weekStart: Date; onWeekChange: (delta: number) => void;
}): JSX.Element {
  const [value, setValue] = useState(prefillTime ?? '');
  const lastPrefill = useRef(prefillTime);
  if (prefillTime && prefillTime !== lastPrefill.current) {
    lastPrefill.current = prefillTime;
    setValue(prefillTime);
  }
  const handleSubmit = (): void => {
    if (!value) return;
    onSubmit(new Date(value).toISOString());
    setValue('');
  };
  return (
    <div className="space-y-2 mt-3">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => onWeekChange(-1)}
          className="px-2 py-1 text-xs text-muted hover:text-foreground border border-edge rounded transition-colors">
          ← Prev Week
        </button>
        <span className="text-xs text-muted">{weekLabel(weekStart)}</span>
        <button type="button" onClick={() => onWeekChange(1)}
          className="px-2 py-1 text-xs text-muted hover:text-foreground border border-edge rounded transition-colors">
          Next Week →
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="datetime-local" data-testid="slot-datetime-picker" value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 px-3 py-2 bg-panel border border-edge rounded-lg text-sm text-foreground focus:ring-2 focus:ring-emerald-500 focus:outline-none"
        />
        <button type="button" onClick={handleSubmit} disabled={!value || isSuggesting}
          className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50">
          Suggest
        </button>
      </div>
    </div>
  );
}

/** Section listing all suggested time slots with voting. */
export function SuggestedTimes({
  slots, myVotedSlotIds, readOnly, onToggleVote, onSuggestSlot,
  isSuggesting, prefillTime, weekStart, onWeekChange,
}: SuggestedTimesProps): JSX.Element {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
        Suggested Times
      </h3>
      {slots.map((slot) => (
        <SlotCard key={slot.id} slot={slot} isVoted={myVotedSlotIds.includes(slot.id)}
          readOnly={readOnly} onToggle={() => onToggleVote(slot.id)} />
      ))}
      {!readOnly && (
        <SuggestSlotForm onSubmit={onSuggestSlot} isSuggesting={isSuggesting}
          prefillTime={prefillTime} weekStart={weekStart} onWeekChange={onWeekChange} />
      )}
    </div>
  );
}
