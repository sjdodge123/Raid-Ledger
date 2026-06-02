/**
 * "Suggest another →" form for the ROK-1300 Scheduling composite.
 *
 * A datetime-local input + Suggest button mirroring the legacy
 * `SuggestedTimes::SuggestSlotForm`. Extracted so the composite stays under
 * the 300-line cap. Hidden in read-only polls.
 */
import { useState, type JSX } from 'react';

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
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!value || isSuggesting}
        className="min-h-[36px] px-4 py-2 rounded-md border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Suggest
      </button>
    </div>
  );
}
