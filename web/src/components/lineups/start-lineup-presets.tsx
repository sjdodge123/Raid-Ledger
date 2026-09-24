/**
 * Preset chooser, scheduling-phase toggle, player-caps note, and the
 * "More options" expander for the StartLineupModal (ROK-1302 / S4).
 *
 * Extracted from the modal to keep both files under the 300-line ESLint limit.
 * Presets are client-applied: clicking one writes canonical match-shape +
 * phase-duration values into the modal's form state. The resolved values are
 * what gets sent to the API — no preset enum is persisted.
 */
import type { JSX, ReactNode } from 'react';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import type { PresetKey } from './start-lineup-config';

/**
 * `[key, label, hint, spanClass]`. The span classes tile five options without
 * an orphaned trailing cell (ROK-1441): mobile is a 2-col grid with Custom
 * spanning both, desktop a 6-col grid laid out 3-then-2.
 */
/**
 * Preset card skin on the ghost Button (ROK-1650, ruling 6: the cards stay
 * Button role=radio rather than a new RadioGroup appearance). The checked paint
 * is keyed off `aria-checked`, so it outranks the ghost variant's base and
 * hover classes without a tailwind-merge; `*:w-full` stretches the Button's
 * label wrapper so the label + hint sit flush left.
 */
const CARD_CLS =
  'w-full border border-edge bg-panel text-left *:w-full ' +
  'aria-checked:border-success/50 aria-checked:bg-success/20 aria-checked:text-success';

type PresetOption = readonly [PresetKey, string, string, string];

const PRESET_OPTIONS: ReadonlyArray<PresetOption> = [
  ['lan', 'LAN', 'Everyone here now · ~30 min', 'sm:col-span-2'],
  ['tonight', 'Tonight', 'Play later today · 5h a phase', 'sm:col-span-2'],
  ['thisWeek', 'This Week', 'Plan the weekly session', 'sm:col-span-2'],
  ['series', 'Series', 'Long-range, many games', 'sm:col-span-3'],
  ['custom', 'Custom', 'Set everything manually', 'col-span-2 sm:col-span-3'],
];

/** One preset option: a ghost Button acting as a radio, label over hint. */
function PresetCard({ option, checked, onSelect }: {
  option: PresetOption;
  checked: boolean;
  onSelect: (key: PresetKey) => void;
}): JSX.Element {
  const [presetKey, label, hint, spanClass] = option;
  return (
    <Button
      variant="ghost"
      size="sm"
      role="radio"
      aria-checked={checked}
      data-testid={`preset-${presetKey}`}
      onClick={() => onSelect(presetKey)}
      className={`${CARD_CLS} ${spanClass}`}
    >
      <span className="flex flex-col items-start">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-[10px] leading-tight text-muted">{hint}</span>
      </span>
    </Button>
  );
}

/** Match-shape preset chooser (LAN / Tonight / This Week / Series / Custom). */
export function PresetChooser({
  value,
  onChange,
}: {
  value: PresetKey;
  onChange: (key: PresetKey) => void;
}): JSX.Element {
  return (
    <div>
      <span className="block text-sm font-medium text-success mb-2">
        Match shape
      </span>
      <div
        role="radiogroup"
        aria-label="Lineup preset"
        className="grid grid-cols-2 gap-2 sm:grid-cols-6"
      >
        {PRESET_OPTIONS.map((option) => (
          <PresetCard key={option[0]} option={option} checked={value === option[0]} onSelect={onChange} />
        ))}
      </div>
    </div>
  );
}

/** Static informational note — player caps come from each game's metadata. */
export function PlayerCapsNote(): JSX.Element {
  return (
    <p className="text-xs text-muted">
      <span className="text-success">Player caps</span> come from each
      game&apos;s metadata once games are nominated.
    </p>
  );
}

/**
 * Top-level "Include scheduling phase" toggle (ROK-1302). Default ON. When
 * off, the lineup terminates at Decided — no scheduling poll is created.
 */
export function SchedulingPhaseToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <Checkbox
      data-testid="include-scheduling-phase"
      checked={enabled}
      onChange={(e) => onChange(e.target.checked)}
      label="Include scheduling phase after game is decided"
      description="Off = the lineup just picks a game; no time-scheduling poll is created."
    />
  );
}

/** Collapsed "More options" expander wrapping the secondary controls. */
export function MoreOptions({ children }: { children: ReactNode }): JSX.Element {
  return (
    <details className="border-t border-edge/30 pt-2">
      <summary className="cursor-pointer text-sm font-medium text-success list-none flex items-center gap-1">
        <span aria-hidden>▶</span> More options
        <span className="text-xs text-muted font-normal">
          (match threshold, votes per player, scheduling, channel, phase
          durations, tiebreaker)
        </span>
      </summary>
      <div className="space-y-4 pt-4">{children}</div>
    </details>
  );
}
