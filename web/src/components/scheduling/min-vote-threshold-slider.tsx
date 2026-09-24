import { useId } from 'react';
import { Slider } from '../ui/slider';
/**
 * MinVoteThresholdSlider — minimum-votes notification slider (ROK-1015).
 * Extracted from create-poll-modal.tsx (ROK-1206). ROK-1650: the shared
 * `Slider` (44px, labelled, "N of M" readout that is also `aria-valuetext`).
 * The outer `data-testid` and the inner `input[type=range]` min/max are smoke
 * selectors (scheduling-poll-threshold.smoke).
 */

/**
 * Slider controlling how many member votes trigger a notification.
 *
 * @param value - Currently selected threshold.
 * @param max - Upper bound (member count or total members).
 * @param onChange - Called with the new threshold when the slider moves.
 */
export function MinVoteThresholdSlider({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const hintId = useId();
  return (
    <div data-testid="min-vote-threshold-slider">
      <Slider
        label="Minimum Votes"
        min={1}
        max={max}
        step={1}
        value={value}
        onChange={onChange}
        formatValue={(v) => `${v} of ${max}`}
        aria-describedby={hintId}
      />
      <p id={hintId} className="text-xs text-muted">
        Notify me when this many members have voted
      </p>
    </div>
  );
}
