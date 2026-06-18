/**
 * DurationPicker — voting-window selector for standalone polls (ROK-1192).
 * Extracted from create-poll-modal.tsx (ROK-1206).
 */

/** Duration options for the standalone poll picker (ROK-1192). */
export const DURATION_OPTIONS = [
  { hours: 24, label: '24 hours' },
  { hours: 48, label: '48 hours' },
  { hours: 72, label: '72 hours' },
  { hours: 168, label: '7 days' },
] as const;

/** Default voting window applied when the modal first opens. */
export const DEFAULT_DURATION_HOURS = 72;

/**
 * Radio-style picker for the poll's voting window.
 *
 * @param value - Currently selected duration in hours.
 * @param onChange - Called with the new duration when a window is picked.
 */
export function DurationPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div
      data-testid="poll-duration-picker"
      className="flex items-center justify-between gap-3"
    >
      <label className="text-sm font-medium text-secondary shrink-0">
        Voting window
      </label>
      <div className="flex gap-1">
        {DURATION_OPTIONS.map((opt) => (
          <label
            key={opt.hours}
            className={`px-2.5 py-1 rounded-md cursor-pointer text-xs border transition-colors ${
              value === opt.hours
                ? 'bg-emerald-600 border-emerald-500 text-foreground'
                : 'bg-surface/50 border-surface text-muted hover:border-emerald-500/50'
            }`}
          >
            <input
              type="radio"
              name="poll-duration"
              value={opt.hours}
              checked={value === opt.hours}
              onChange={() => onChange(opt.hours)}
              className="sr-only"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  );
}
