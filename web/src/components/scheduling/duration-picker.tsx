/**
 * DurationPicker — voting-window selector for standalone polls (ROK-1192).
 * Extracted from create-poll-modal.tsx (ROK-1206).
 */
import { DURATION_OPTIONS } from './duration-options';

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
