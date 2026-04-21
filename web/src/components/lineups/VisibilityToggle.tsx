/**
 * Visibility toggle for the Start Lineup modal (ROK-1065).
 * Switches the lineup between public and private modes. When private is
 * selected, the parent form must collect invitees before submitting.
 */
import { type JSX } from 'react';

export interface VisibilityToggleProps {
  value: 'public' | 'private';
  onChange: (next: 'public' | 'private') => void;
}

/** Render a labeled segmented control for lineup visibility. */
export function VisibilityToggle({
  value,
  onChange,
}: VisibilityToggleProps): JSX.Element {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-primary">Visibility</legend>
      <div
        role="radiogroup"
        aria-label="Lineup visibility"
        className="flex gap-2"
      >
        <button
          type="button"
          role="radio"
          aria-checked={value === 'public'}
          onClick={() => onChange('public')}
          data-testid="visibility-public"
          className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
            value === 'public'
              ? 'bg-emerald-600 text-white border-emerald-500'
              : 'bg-panel border-edge text-secondary hover:bg-overlay'
          }`}
        >
          Public
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === 'private'}
          onClick={() => onChange('private')}
          data-testid="visibility-private"
          className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
            value === 'private'
              ? 'bg-amber-600 text-white border-amber-500'
              : 'bg-panel border-edge text-secondary hover:bg-overlay'
          }`}
        >
          Private
        </button>
      </div>
      <p className="text-xs text-muted">
        {value === 'public'
          ? 'Every community member can nominate and vote.'
          : 'Only invited users (plus admins) can nominate and vote. At least one invitee required.'}
      </p>
    </fieldset>
  );
}
