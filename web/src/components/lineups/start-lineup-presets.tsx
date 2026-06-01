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
import type { PresetKey } from './start-lineup-config';

const PRESET_OPTIONS: ReadonlyArray<readonly [PresetKey, string, string]> = [
  ['tonight', 'Tonight', 'Pick one game now · ~30 min'],
  ['thisWeek', 'This Week', 'Plan the weekly session'],
  ['series', 'Series', 'Long-range, many games'],
  ['custom', 'Custom', 'Set everything manually'],
];

/** Match-shape preset chooser (Tonight / This Week / Series / Custom). */
export function PresetChooser({
  value,
  onChange,
}: {
  value: PresetKey;
  onChange: (key: PresetKey) => void;
}): JSX.Element {
  return (
    <div>
      <span className="block text-sm font-medium text-emerald-300 mb-2">
        Match shape
      </span>
      <div
        role="radiogroup"
        aria-label="Lineup preset"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {PRESET_OPTIONS.map(([key, label, hint]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={value === key}
            data-testid={`preset-${key}`}
            onClick={() => onChange(key)}
            className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors ${
              value === key
                ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                : 'bg-panel border-edge text-muted hover:text-foreground'
            }`}
          >
            <span className="text-sm font-medium">{label}</span>
            <span className="text-[10px] leading-tight text-muted">{hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Static informational note — player caps come from each game's metadata. */
export function PlayerCapsNote(): JSX.Element {
  return (
    <p className="text-xs text-muted">
      <span className="text-emerald-400">Player caps</span> come from each
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
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        data-testid="include-scheduling-phase"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-emerald-500"
      />
      <span className="text-sm text-secondary">
        Include scheduling phase after game is decided
        <span className="block text-xs text-muted">
          Off = the lineup just picks a game; no time-scheduling poll is created.
        </span>
      </span>
    </label>
  );
}

/** Collapsed "More options" expander wrapping the secondary controls. */
export function MoreOptions({ children }: { children: ReactNode }): JSX.Element {
  return (
    <details className="border-t border-edge/30 pt-2">
      <summary className="cursor-pointer text-sm font-medium text-emerald-300 list-none flex items-center gap-1">
        <span aria-hidden>▶</span> More options
        <span className="text-xs text-muted font-normal">
          (description, channel, phase durations, tiebreaker)
        </span>
      </summary>
      <div className="space-y-4 pt-4">{children}</div>
    </details>
  );
}
