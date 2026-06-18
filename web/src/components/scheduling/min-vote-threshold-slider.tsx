/**
 * MinVoteThresholdSlider — minimum-votes notification slider (ROK-1015).
 * Extracted from create-poll-modal.tsx (ROK-1206).
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
  return (
    <div data-testid="min-vote-threshold-slider">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-secondary">
          Minimum Votes
        </label>
        <span className="text-sm text-muted tabular-nums">
          {value} of {max}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-surface/50 rounded-lg appearance-none cursor-pointer accent-emerald-500"
      />
      <p className="text-xs text-muted/60 mt-1">
        Notify me when this many members have voted
      </p>
    </div>
  );
}
