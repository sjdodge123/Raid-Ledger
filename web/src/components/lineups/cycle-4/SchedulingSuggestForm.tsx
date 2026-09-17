/**
 * "Suggest another →" form for the ROK-1300 Scheduling composite.
 *
 * A datetime-local input + Suggest button mirroring the legacy
 * `SuggestedTimes::SuggestSlotForm`. Extracted so the composite stays under
 * the 300-line cap. Hidden in read-only polls.
 *
 * ROK-1588 (Q8): this form IS the "Find a better time" footer CTA — the button
 * names the time it will submit ("Suggest Wed 9 PM"), derived from its own
 * value, so a cell pick and a typed time read the same way.
 */
import { useState, type JSX } from 'react';
import { suggestButtonLabel } from './scheduling-availability';

export interface SchedulingSuggestFormProps {
  prefillTime?: string;
  isSuggesting: boolean;
  onSuggest: (proposedTime: string) => void;
}

/** Suggested-time form — see file-level docstring. */
export function SchedulingSuggestForm({
  prefillTime,
  isSuggesting,
  onSuggest,
}: SchedulingSuggestFormProps): JSX.Element {
  const [localValue, setLocalValue] = useState('');
  const value = localValue || prefillTime || '';

  const handleSubmit = (): void => {
    if (!value) return;
    onSuggest(new Date(value).toISOString());
    setLocalValue('');
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted">
        Suggest another time
        <input
          type="datetime-local"
          data-testid="slot-datetime-picker"
          value={value}
          onChange={(e) => setLocalValue(e.target.value)}
          className="px-3 py-2 bg-panel border border-edge rounded-lg text-sm text-foreground focus:ring-2 focus:ring-emerald-500 focus:outline-none"
        />
      </label>
      <SuggestButton value={value} disabled={!value || isSuggesting} onClick={handleSubmit} />
    </div>
  );
}

/** The submit button; its label names the time it will submit (Q8). */
function SuggestButton({ value, disabled, onClick }: {
  value: string; disabled: boolean; onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-[36px] px-4 py-2 rounded-md border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {suggestButtonLabel(value)}
    </button>
  );
}
