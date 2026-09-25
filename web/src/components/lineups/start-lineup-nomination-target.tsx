/**
 * ROK-1444 — "open voting early" nomination target, under "More options".
 *
 * Optional by design: `null` keeps the lineup on today's deadline-only
 * behaviour, so the control is a toggle plus a slider rather than a bare
 * slider with a magic "off" position.
 *
 * The target is a percentage of the DYNAMIC nomination cap
 * (`max(20, nominators x 5)`), not an absolute game count, so the helper copy
 * names the cap explicitly — the denominator is the part operators get wrong.
 * The cap ratchets upward only (`nomination_cap_peak`), so the bar never moves
 * backwards under the group mid-lineup.
 */
import type { JSX } from 'react';
import { Checkbox } from '../ui/checkbox';
import { Slider } from '../ui/slider';

/** Percentage used when the operator first switches the target on. */
export const DEFAULT_NOMINATION_TARGET_PCT = 75;

export function NominationTargetControl({
  value,
  onChange,
}: {
  /** Percentage of the cap, or null when the target is off. */
  value: number | null;
  onChange: (next: number | null) => void;
}): JSX.Element {
  const enabled = value !== null;
  return (
    <div className="space-y-2">
      <Checkbox
        data-testid="nomination-target-enabled"
        checked={enabled}
        onChange={(e) =>
          onChange(e.target.checked ? DEFAULT_NOMINATION_TARGET_PCT : null)
        }
        label="Open voting early once enough games are nominated"
        description="Off = voting opens only when the building phase deadline expires."
      />
      {enabled && <NominationTargetSlider value={value} onChange={onChange} />}
    </div>
  );
}

/** The 25-100% target, shown only while the toggle is on. */
function NominationTargetSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}): JSX.Element {
  return (
    <div className="pl-8">
      <Slider
        id="nomination-target-pct"
        label="Nomination target"
        data-testid="nomination-target-pct"
        min={25}
        max={100}
        step={5}
        value={value}
        onChange={onChange}
        formatValue={(v) => `${v}%`}
      />
      <p className="text-xs text-muted/80">
        Percentage of the nomination cap — 20 games, plus 5 for every extra
        person who nominates. Voting still opens at the deadline if the target
        is never reached.
      </p>
    </div>
  );
}
