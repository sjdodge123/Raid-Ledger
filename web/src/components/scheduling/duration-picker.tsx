/**
 * DurationPicker — voting-window selector for standalone polls (ROK-1192).
 * Extracted from create-poll-modal.tsx (ROK-1206). ROK-1650: the shared
 * segmented `RadioGroup` (operator ruling). No required asterisk — the group
 * always has a value (ruling 8). The wrapper testid is a test selector.
 */
import { RadioGroup } from '../ui/radio-group';
import { DURATION_OPTIONS } from './duration-options';

const OPTIONS = DURATION_OPTIONS.map((opt) => ({
  value: String(opt.hours),
  label: opt.label,
}));

/**
 * Segmented picker for the poll's voting window.
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
    <div data-testid="poll-duration-picker">
      <RadioGroup
        label="Voting window"
        appearance="segmented"
        name="poll-duration"
        options={OPTIONS}
        value={String(value)}
        onChange={(v) => onChange(Number(v))}
      />
    </div>
  );
}
