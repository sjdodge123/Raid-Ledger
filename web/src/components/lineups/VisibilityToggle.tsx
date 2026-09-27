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

type Visibility = VisibilityToggleProps['value'];

/**
 * 44px tap target; the checked option takes its status token (success = open to all,
 * warning = invite-only) as a tint behind foreground text, with the full-strength token
 * border as the non-colour-text indicator. Tokens flip with every scheme.
 */
const OPTION = 'flex-1 min-h-[44px] px-3 py-2 text-sm rounded-lg border transition-colors';
const CHECKED: Record<Visibility, string> = {
  public: 'bg-success/15 border-success text-foreground',
  private: 'bg-warning/15 border-warning text-foreground',
};
const UNCHECKED = 'bg-panel border-edge text-secondary hover:bg-overlay';

const optionClass = (option: Visibility, value: Visibility): string =>
  `${OPTION} ${option === value ? CHECKED[option] : UNCHECKED}`;

/** Render a labeled segmented control for lineup visibility. */
export function VisibilityToggle({
  value,
  onChange,
}: VisibilityToggleProps): JSX.Element {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">Visibility</legend>
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
          className={optionClass('public', value)}
        >
          Public
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === 'private'}
          onClick={() => onChange('private')}
          data-testid="visibility-private"
          className={optionClass('private', value)}
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
