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
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';

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
      <Field label="Suggest another time">
        <Input
          type="datetime-local"
          data-testid="slot-datetime-picker"
          value={value}
          onChange={(e) => setLocalValue(e.target.value)}
        />
      </Field>
      <SuggestButton value={value} disabled={!value || isSuggesting} onClick={handleSubmit} />
    </div>
  );
}

/** The submit button; its label names the time it will submit (Q8). */
function SuggestButton({ value, disabled, onClick }: {
  value: string; disabled: boolean; onClick: () => void;
}): JSX.Element {
  return (
    <Button variant="primary" size="sm" onClick={onClick} disabled={disabled}>
      {suggestButtonLabel(value)}
    </Button>
  );
}
